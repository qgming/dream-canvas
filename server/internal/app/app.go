package app

import (
	"context"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

type App struct {
	db *gorm.DB
	root string
	transfers *fileGate
	previews *fileGate
	credentials cipher.AEAD
	eventsMu sync.Mutex
	events map[string]map[chan string]bool
	assetFiles sync.RWMutex
	ctx context.Context
	stop context.CancelFunc
	wake chan struct{}
	workers sync.WaitGroup
	workMu sync.Mutex
	active map[string]context.CancelFunc
	previewMu sync.Mutex
	clients clientRegistry
	logs *appLogger
}

type Problem struct { Status int; Code, Message string }
func (e *Problem) Error() string { return e.Message }
func problem(status int, code, message string) error { return &Problem{status, code, message} }

func Open(root string) (*App, error) {
	if err := os.MkdirAll(filepath.Join(root, "assets"), 0700); err != nil { return nil, err }
	db, err := gorm.Open(sqlite.Open(filepath.Join(root, "dream-canvas.sqlite")), &gorm.Config{TranslateError: true, Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil { return nil, err }
	conn, err := db.DB()
	if err != nil { return nil, err }
	conn.SetMaxOpenConns(1)
	for _, statement := range []string{"PRAGMA journal_mode=WAL", "PRAGMA foreign_keys=ON"} {
		if err := db.Exec(statement).Error; err != nil { conn.Close(); return nil, err }
	}
	if err := db.AutoMigrate(&User{}, &Session{}, &Project{}, &ProjectRevision{}, &Asset{}, &AssetReference{}, &Channel{}, &ChannelModel{}, &ModelOrdering{}, &ModelScript{}, &ScriptDraft{}, &ScriptVersion{}, &CanvasPluginRecord{}, &CanvasPluginDraft{}, &CanvasPluginVersion{}, &AccessToken{}, &UserPreference{}, &WorkbenchRecord{}, &GenerationTask{}, &TaskAsset{}, &AssetVoice{}, &Prompt{}, &ClientCommand{}, &AssistantThread{}, &AssistantTurn{}, &AssistantItem{}, &AssistantSkill{}, &RuntimeSettings{}, &LogSettings{}, &ObjectStorage{}, &FileOperation{}, &UsageEntry{}, &UsageCorrection{}); err != nil { conn.Close(); return nil, err }
	if _, err := os.Stat(filepath.Join(root, "credentials.key")); errors.Is(err, os.ErrNotExist) {
		var count int64
		if err := db.Model(&Channel{}).Where("secret <> ?", "").Count(&count).Error; err != nil { conn.Close(); return nil, err }
		var storageCount, taskCount, turnCount int64
		for _, check := range []struct{ Model any; Count *int64 }{{&ObjectStorage{}, &storageCount}, {&GenerationTask{}, &taskCount}, {&AssistantTurn{}, &turnCount}} { if err := db.Model(check.Model).Count(check.Count).Error; err != nil { conn.Close(); return nil, err } }
		if count+storageCount+taskCount+turnCount > 0 { conn.Close(); return nil, errors.New("凭据加密密钥丢失，请恢复 data/credentials.key；不能生成新密钥覆盖现有配置和任务快照") }
	}
	credentials, err := openKey(root)
	if err != nil { conn.Close(); return nil, err }
	ctx, stop := context.WithCancel(context.Background())
	service := &App{db: db, root: root, transfers: newFileGate(), previews: newFileGate(), credentials: credentials, events: map[string]map[chan string]bool{}, ctx: ctx, stop: stop, wake: make(chan struct{}, 1), active: map[string]context.CancelFunc{}}
	service.clients.entries = map[string]onlineClient{}
	if err := service.openLogger(); err != nil { stop(); conn.Close(); return nil, err }
	if err := service.installBuiltinScripts(); err != nil { stop(); conn.Close(); return nil, err }
	if err := service.installBuiltinCanvasPlugins(); err != nil { stop(); conn.Close(); return nil, err }
	if err := db.Model(&Asset{}).Where("save_state = ?", "saving").Updates(map[string]any{"save_state": "failed", "error": "服务在文件保存完成前停止，原件尚未可靠保留，请重新上传"}).Error; err != nil { conn.Close(); return nil, err }
	var pending []Asset
	if err := db.Where("delete_state = ?", "pending").Find(&pending).Error; err != nil { conn.Close(); return nil, err }
	for _, asset := range pending { if err := queueAssetCleanup(db, asset.ID); err != nil { stop(); conn.Close(); return nil, err } }
	if err := service.recoverExecution(); err != nil { stop(); conn.Close(); return nil, err }
	service.workers.Add(1)
	go service.schedule()
	service.logEvent(ctx, slog.LevelInfo, "service.ready")
	return service, nil
}

func (a *App) Close() { a.stop(); a.workers.Wait(); a.logEvent(a.ctx, slog.LevelInfo, "service.stopped"); if a.logs != nil { _ = a.logs.store.Close() }; if db, err := a.db.DB(); err == nil { db.Close() } }

func identifier() string {
	value := make([]byte, 32)
	if _, err := rand.Read(value); err != nil { panic(err) }
	return hex.EncodeToString(value)
}

func digest(value string) string { hash := sha256.Sum256([]byte(value)); return hex.EncodeToString(hash[:]) }

func respondError(c *gin.Context, err error) {
	c.Set("request_error", err)
	status, code, message := http.StatusInternalServerError, "internal_error", "操作失败，请重试"
	var p *Problem
	if errors.As(err, &p) { status, code, message = p.Status, p.Code, p.Message
	} else if errors.Is(err, gorm.ErrRecordNotFound) { status, code, message = 404, "not_found", "内容不存在或无权访问"
	} else if errors.Is(err, gorm.ErrDuplicatedKey) { status, code, message = 409, "already_exists", "内容已存在" }
	c.AbortWithStatusJSON(status, gin.H{"code": code, "message": message})
}

func bind(c *gin.Context, target any) bool {
	if err := c.ShouldBindJSON(target); err != nil { var limit *http.MaxBytesError; if errors.As(err, &limit) { respondError(c, problem(413, "request_too_large", "请求超过管理员配置的大小限制")) } else { respondError(c, problem(400, "invalid_input", "请求内容不正确")) }; return false }
	return true
}

func currentUser(c *gin.Context) User { return c.MustGet("user").(User) }

func (a *App) Router(web, trustedProxies string) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	if err := configureTrustedProxies(r, trustedProxies); err != nil { panic(err) }
	r.Use(a.requestLogger(), gin.CustomRecoveryWithWriter(nil, a.recoverRequest), func(c *gin.Context) {
		if policy, err := a.executionPolicy(); err == nil && policy.JSONBytes > 0 && strings.Contains(c.GetHeader("Content-Type"), "application/json") { c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, policy.JSONBytes) }
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("Referrer-Policy", "same-origin")
		c.Header("Cache-Control", "no-store")
		if origin := c.GetHeader("Origin"); origin != "" && c.Request.Method != "GET" && c.Request.Method != "HEAD" {
			u, err := url.Parse(origin)
			if err != nil || !strings.EqualFold(u.Host, c.Request.Host) { respondError(c, problem(403, "invalid_origin", "请求来源不正确")); return }
		}
		c.Next()
	})
	api := r.Group("/api")
	api.GET("/health", func(c *gin.Context) { c.JSON(200, gin.H{"ok": true}) })
	api.GET("/auth/status", func(c *gin.Context) {
		var count int64
		if err := a.db.Model(&User{}).Count(&count).Error; err != nil { respondError(c, err); return }
		open, err := a.siteOpen(); if err != nil { respondError(c, err); return }
		c.JSON(200, gin.H{"initialized": count > 0, "open": open})
	})
	api.POST("/auth/login", a.login)
	remote := a.mcpHandler()
	r.Any("/mcp", func(c *gin.Context) {
		header := c.GetHeader("Authorization")
		if !strings.HasPrefix(header, "Bearer ") { respondError(c, problem(401, "token_required", "需要 Bearer Token")); return }
		if _, err := a.tokenPrincipal(strings.TrimPrefix(header, "Bearer ")); err != nil { respondError(c, err); return }
		remote.ServeHTTP(c.Writer, c.Request)
	})
	authed := api.Group("", a.authenticate)
	authed.GET("/auth/me", func(c *gin.Context) { c.JSON(200, gin.H{"user": currentUser(c), "csrf": c.GetString("csrf")}) })
	authed.POST("/auth/logout", a.logout)
	authed.POST("/auth/password", a.changePassword)
	authed.GET("/preferences/:name", a.getPreference)
	authed.PUT("/preferences/:name", a.savePreference)
	authed.GET("/prompts", a.listPrompts)
	authed.POST("/prompts", a.savePrompt)
	authed.GET("/prompts/:id", a.getPrompt)
	authed.PUT("/prompts/:id", a.savePrompt)
	authed.DELETE("/prompts/:id", a.deletePrompt)
	authed.POST("/clients", a.saveClient)
	authed.DELETE("/clients/:id", a.removeClient)
	authed.GET("/clients/:id/events", a.clientEvents)
	authed.POST("/clients/:id/commands/:commandId", a.acknowledgeClient)
	authed.GET("/workbench/:kind/records", a.listWorkbenchRecords)
	authed.PUT("/workbench/:kind/records/:id", a.saveWorkbenchRecord)
	authed.DELETE("/workbench/:kind/records/:id", a.deleteWorkbenchRecord)
	authed.GET("/tokens", a.listTokens)
	authed.POST("/tokens", a.createToken)
	authed.POST("/tokens/:id/revoke", a.revokeToken)
	authed.GET("/projects", a.listProjects)
	authed.GET("/events", a.userEvents)
	authed.GET("/tasks", a.listTasks)
	authed.POST("/tasks", a.createTask)
	authed.GET("/tasks/:id", a.getTask)
	authed.GET("/tasks/:id/events", a.taskEvents)
	authed.POST("/tasks/:id/cancel", a.cancelTask)
	authed.POST("/tasks/:id/resume", a.resumeTask)
	authed.POST("/tasks/:id/resolve", a.resolveTask)
	authed.DELETE("/tasks/:id", a.deleteTask)
	authed.POST("/tasks/:id/project-version", a.taskProjectVersion)
	authed.GET("/usage", a.listUsage)
	authed.GET("/assistant/threads", a.listAssistantThreads)
	authed.POST("/assistant/threads", a.createAssistantThread)
	authed.GET("/assistant/threads/:id", a.getAssistantThread)
	authed.PATCH("/assistant/threads/:id", a.renameAssistantThread)
	authed.DELETE("/assistant/threads/:id", a.deleteAssistantThread)
	authed.POST("/assistant/threads/:id/turns", a.startAssistantTurn)
	authed.POST("/assistant/turns/:id/cancel", a.cancelAssistantTurn)
	authed.POST("/assistant/turns/:id/answer", a.answerAssistantTurn)
	authed.POST("/assistant/skill-drafts", a.createSkillDraft)
	authed.GET("/assistant/skill-drafts/:id", a.getSkillDraft)
	authed.GET("/assistant/skills", a.listAssistantSkills)
	authed.POST("/assistant/skills", a.saveAssistantSkill)
	authed.GET("/assistant/skills/:name", a.getAssistantSkill)
	authed.PUT("/assistant/skills/:name", a.saveAssistantSkill)
	authed.DELETE("/assistant/skills/:name", a.deleteAssistantSkill)
	authed.GET("/catalog", a.modelCatalog)
	authed.POST("/projects", a.createProject)
	authed.GET("/projects/:id", a.getProject)
	authed.PUT("/projects/:id", a.saveProject)
	authed.DELETE("/projects/:id", a.deleteProject)
	authed.GET("/projects/:id/history", a.projectHistory)
	authed.POST("/projects/:id/revert", a.revertProject)
	authed.GET("/assets", a.listAssets)
	authed.GET("/asset-storages", a.assetStorageOptions)
	authed.POST("/assets", a.uploadAsset)
	authed.POST("/assets/text", a.createTextAsset)
	authed.POST("/assets/:id/cleanup", a.retryAssetCleanup)
	authed.POST("/assets/:id/sync", a.retryAssetSync)
	authed.POST("/assets/:id/migrate", a.migrateAsset)
	authed.GET("/assets/:id", a.getAsset)
	authed.GET("/assets/:id/file", a.assetFile)
	authed.GET("/assets/:id/preview", a.assetPreview)
	authed.PATCH("/assets/:id", a.updateAsset)
	authed.DELETE("/assets/:id", a.deleteAsset)
	authed.GET("/assets/:id/voices", a.listAssetVoices)
	authed.PUT("/assets/:id/voices/:channelId", a.saveAssetVoice)
	admin := authed.Group("/admin", func(c *gin.Context) {
		if currentUser(c).Role != "admin" { respondError(c, problem(403, "forbidden", "需要管理员权限")); return }
		c.Next()
	})
	admin.GET("/users", a.listUsers)
	a.canvasPluginRoutes(authed, admin)
	admin.POST("/tasks/:id/recover-query", a.recoverTaskQuery)
	admin.POST("/users", a.createUser)
	admin.PATCH("/users/:id", a.updateUser)
	admin.POST("/users/:id/password", a.resetPassword)
	admin.GET("/channels", a.listChannels)
	admin.GET("/model-ordering", a.getModelOrdering)
	admin.PUT("/model-ordering", a.saveModelOrdering)
	admin.GET("/channel-templates", a.listChannelTemplates)
	admin.POST("/channel-templates/:template", a.installChannelTemplate)
	admin.GET("/site", a.getSiteSettings)
	admin.PUT("/site", a.saveSiteSettings)
	admin.GET("/logging", a.getLogSettings)
	admin.PUT("/logging", a.saveLogSettings)
	admin.GET("/logging/entries", a.readLogs)
	admin.DELETE("/logging/entries", a.clearLogs)
	admin.GET("/storages", a.listStorages)
	admin.POST("/storages", a.saveStorage)
	admin.POST("/storages/test", a.testStorage)
	admin.PUT("/storages/:id", a.saveStorage)
	admin.DELETE("/storages/:id", a.deleteStorage)
	admin.GET("/usage", a.listUsage)
	admin.POST("/channels", a.saveChannel)
	admin.GET("/channels/:channelId", a.getChannelForEditing)
	admin.PUT("/channels/:channelId", a.saveChannel)
	admin.DELETE("/channels/:channelId", a.deleteChannel)
	admin.POST("/channels/:channelId/models", a.saveChannelModel)
	admin.PUT("/channels/:channelId/models/:modelId", a.saveChannelModel)
    admin.POST("/channels/:channelId/models/batch", a.saveChannelModels)
    admin.GET("/channels/:channelId/models/remote", a.discoverChannelModels)
    admin.GET("/model-scripts", a.listModelScripts)
    admin.GET("/model-script-contract", a.getModelScriptContract)
    admin.POST("/model-scripts/check", a.checkModelScript)
    admin.POST("/model-scripts", a.createModelScript)
    admin.GET("/model-scripts/:adapterId", a.getModelScript)
    admin.DELETE("/model-scripts/:adapterId", a.deleteModelScript)
    admin.PUT("/model-scripts/:adapterId/draft", a.saveScriptDraft)
    admin.POST("/model-scripts/:adapterId/publish", a.publishModelScript)
    admin.POST("/model-scripts/:adapterId/test", a.testModelScript)
    admin.GET("/model-scripts/:adapterId/evidence", a.getModelScriptEvidence)
	root, err := filepath.Abs(web)
	if err == nil {
		r.NoRoute(func(c *gin.Context) {
			if strings.HasPrefix(c.Request.URL.Path, "/api/") || (c.Request.Method != "GET" && c.Request.Method != "HEAD") { c.Status(404); return }
			name := filepath.Join(root, filepath.FromSlash(strings.TrimPrefix(c.Request.URL.Path, "/")))
			rel, err := filepath.Rel(root, name)
			if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) { c.Status(404); return }
			if stat, err := os.Stat(name); err == nil && !stat.IsDir() { c.File(name); return }
			if _, err := os.Stat(filepath.Join(root, "index.html")); err != nil { c.String(404, "前端尚未构建，请使用 Vite 开发服务"); return }
			c.File(filepath.Join(root, "index.html"))
		})
	}
	return r
}

func validTitle(title string) error {
	if strings.TrimSpace(title) == "" { return problem(400, "title_required", "名称不能为空") }
	return nil
}

func (a *App) assetPath(id string) (string, error) {
	if len(id) != 64 { return "", fmt.Errorf("invalid asset id") }
	if _, err := hex.DecodeString(id); err != nil { return "", err }
	return filepath.Join(a.root, "assets", id), nil
}
