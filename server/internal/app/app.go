package app

import (
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
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
	transfers chan struct{}
	previews chan struct{}
	credentials cipher.AEAD
	eventsMu sync.Mutex
	events map[string]map[chan struct{}]bool
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
	if err := db.AutoMigrate(&User{}, &Session{}, &Project{}, &Asset{}, &AssetReference{}, &Approval{}, &Channel{}, &ChannelModel{}, &InterfaceDraft{}, &InterfaceVersion{}, &AccessToken{}, &UserPreference{}, &WorkbenchRecord{}, &GenerationTask{}, &TaskAsset{}, &AssistantThread{}, &AssistantTurn{}, &AssistantItem{}, &AssistantSkill{}); err != nil { conn.Close(); return nil, err }
	if _, err := os.Stat(filepath.Join(root, "credentials.key")); errors.Is(err, os.ErrNotExist) {
		var count int64
		if err := db.Model(&Channel{}).Where("secret <> ?", "").Count(&count).Error; err != nil { conn.Close(); return nil, err }
		if count > 0 { conn.Close(); return nil, errors.New("凭据加密密钥丢失，请恢复 data/credentials.key；不能生成新密钥覆盖现有配置") }
	}
	credentials, err := openKey(root)
	if err != nil { conn.Close(); return nil, err }
	service := &App{db: db, root: root, transfers: make(chan struct{}, 1), previews: make(chan struct{}, 1), credentials: credentials, events: map[string]map[chan struct{}]bool{}}
	if err := db.Model(&Asset{}).Where("save_state = ?", "saving").Updates(map[string]any{"save_state": "failed", "error": "服务在文件保存完成前停止，原件尚未可靠保留，请重新上传"}).Error; err != nil { conn.Close(); return nil, err }
	var pending []Asset
	if err := db.Where("delete_state = ?", "pending").Find(&pending).Error; err != nil { conn.Close(); return nil, err }
	for _, asset := range pending { _ = service.cleanAsset(asset.ID) }
	return service, nil
}

func (a *App) Close() { if db, err := a.db.DB(); err == nil { db.Close() } }

func identifier() string {
	value := make([]byte, 32)
	if _, err := rand.Read(value); err != nil { panic(err) }
	return hex.EncodeToString(value)
}

func digest(value string) string { hash := sha256.Sum256([]byte(value)); return hex.EncodeToString(hash[:]) }

func respondError(c *gin.Context, err error) {
	status, code, message := http.StatusInternalServerError, "internal_error", "操作失败，请重试"
	var p *Problem
	if errors.As(err, &p) { status, code, message = p.Status, p.Code, p.Message
	} else if errors.Is(err, gorm.ErrRecordNotFound) { status, code, message = 404, "not_found", "内容不存在或无权访问"
	} else if errors.Is(err, gorm.ErrDuplicatedKey) { status, code, message = 409, "already_exists", "内容已存在" }
	c.AbortWithStatusJSON(status, gin.H{"code": code, "message": message})
}

func bind(c *gin.Context, target any) bool {
	if err := c.ShouldBindJSON(target); err != nil { respondError(c, problem(400, "invalid_input", "请求内容不正确")); return false }
	return true
}

func currentUser(c *gin.Context) User { return c.MustGet("user").(User) }

func (a *App) Router(web string) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	if err := r.SetTrustedProxies([]string{"127.0.0.1", "::1"}); err != nil { panic(err) }
	r.Use(gin.Recovery(), func(c *gin.Context) {
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
		c.JSON(200, gin.H{"initialized": count > 0})
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
	authed.GET("/assistant/threads", a.listAssistantThreads)
	authed.POST("/assistant/threads", a.createAssistantThread)
	authed.GET("/assistant/threads/:id", a.getAssistantThread)
	authed.DELETE("/assistant/threads/:id", a.deleteAssistantThread)
	authed.POST("/assistant/threads/:id/turns", a.startAssistantTurn)
	authed.POST("/assistant/turns/:id/cancel", a.cancelAssistantTurn)
	authed.POST("/assistant/skill-drafts", func(c *gin.Context) { respondError(c, executionUnavailable()) })
	authed.GET("/assistant/skills", a.listAssistantSkills)
	authed.POST("/assistant/skills", a.saveAssistantSkill)
	authed.GET("/assistant/skills/:name", a.getAssistantSkill)
	authed.PUT("/assistant/skills/:name", a.saveAssistantSkill)
	authed.DELETE("/assistant/skills/:name", a.deleteAssistantSkill)
	authed.GET("/catalog", a.modelCatalog)
	authed.POST("/projects", a.createProject)
	authed.GET("/projects/:id", a.getProject)
	authed.PUT("/projects/:id", a.saveProject)
	authed.GET("/assets", a.listAssets)
	authed.POST("/assets", a.uploadAsset)
	authed.POST("/assets/text", a.createTextAsset)
	authed.POST("/assets/:id/cleanup", a.retryAssetCleanup)
	authed.GET("/assets/:id", a.getAsset)
	authed.GET("/assets/:id/file", a.assetFile)
	authed.GET("/assets/:id/preview", a.assetPreview)
	authed.PATCH("/assets/:id", a.updateAsset)
	authed.GET("/approvals", a.listApprovals)
	authed.POST("/approvals", a.createApproval)
	authed.POST("/approvals/:id/decision", a.decideApproval)
	admin := authed.Group("/admin", func(c *gin.Context) {
		if currentUser(c).Role != "admin" { respondError(c, problem(403, "forbidden", "需要管理员权限")); return }
		c.Next()
	})
	admin.GET("/users", a.listUsers)
	admin.POST("/users", a.createUser)
	admin.PATCH("/users/:id", a.updateUser)
	admin.POST("/users/:id/password", a.resetPassword)
	admin.GET("/channels", a.listChannels)
	admin.POST("/channels", a.saveChannel)
	admin.PUT("/channels/:channelId", a.saveChannel)
	admin.POST("/channels/:channelId/models", a.saveChannelModel)
	admin.PUT("/channels/:channelId/models/:modelId", a.saveChannelModel)
	admin.GET("/models/:modelId/interface", a.getInterface)
	admin.PUT("/models/:modelId/interface", a.saveInterface)
	admin.POST("/models/:modelId/interface/publish", a.publishInterface)
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
