package app

import (
	"encoding/json"
	"errors"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/gabriel-vasile/mimetype"
	_ "golang.org/x/image/webp"
	"gorm.io/gorm"
)

func (a *App) listAssets(c *gin.Context) {
	assets := []Asset{}
	query := a.db.Where("user_id = ?", currentUser(c).ID)
	if c.Query("deleting") == "true" { query = query.Where("delete_state = ?", "pending") } else { query = query.Where("delete_state = ?", "") }
	if err := query.Order("created_at DESC").Find(&assets).Error; err != nil { respondError(c, err); return }
	c.JSON(200, assets)
}

func (a *App) getAsset(c *gin.Context) {
	var asset Asset
	if err := a.db.First(&asset, "id = ? AND user_id = ?", c.Param("id"), currentUser(c).ID).Error; err != nil { respondError(c, err); return }
	c.JSON(200, asset)
}

// A raw upload streams directly to its final persistent path. It is never a multipart temp file.
func (a *App) uploadAsset(c *gin.Context) {
	select {
	case a.transfers <- struct{}{}:
		defer func() { <-a.transfers }()
	case <-c.Request.Context().Done():
		return
	}
	mimeType, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
	if err != nil || (!strings.HasPrefix(mimeType, "image/") && !strings.HasPrefix(mimeType, "video/") && !strings.HasPrefix(mimeType, "audio/")) {
		respondError(c, problem(400, "invalid_media", "只支持图片、视频和音频原件")); return
	}
	id := identifier()
	name, err := a.assetPath(id)
	if err != nil { respondError(c, err); return }
	title, _ := url.QueryUnescape(c.GetHeader("X-File-Name"))
	asset := Asset{ID: id, UserID: currentUser(c).ID, Kind: strings.Split(mimeType, "/")[0], Title: title, MimeType: mimeType, Path: id, SaveState: "saving", SyncState: "local", Metadata: JSON(`{}`)}
	if asset.Title == "" { asset.Title = "未命名素材" }
	if err := a.db.Create(&asset).Error; err != nil { respondError(c, err); return }
	defer a.notify(asset.UserID)
	fail := func(status int, code, message string) {
		if err := a.db.Model(&Asset{}).Where("id = ? AND save_state = ?", asset.ID, "saving").Updates(map[string]any{"save_state": "failed", "bytes": asset.Bytes, "error": message}).Error; err != nil { respondError(c, problem(500, "metadata_failed", "文件保存未完成，且失败状态记录失败，请检查服务器磁盘与数据库")); return }
		respondError(c, problem(status, code, message))
	}
	file, err := os.OpenFile(name, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err == nil {
		asset.Bytes, err = io.Copy(file, c.Request.Body)
		if err == nil { err = file.Sync() }
		closeErr := file.Close()
		if err == nil { err = closeErr }
	}
	if err == nil && asset.Bytes == 0 { err = errors.New("empty media") }
	if err != nil {
		fail(500, "save_failed", "文件未能完整写入持久目录，尚未可靠保留，请重新上传"); return
	}
	file, err = os.Open(name)
	if err != nil { fail(500, "file_unavailable", "原件已写入，但无法读取文件类型，请检查服务器磁盘"); return }
	detected, detectErr := mimetype.DetectReader(file)
	file.Close()
	if detectErr != nil { fail(500, "file_unavailable", "文件类型读取失败，尚未完成资产保存"); return }
	actual, _, parseErr := mime.ParseMediaType(detected.String())
	if parseErr != nil || !strings.HasPrefix(actual, asset.Kind+"/") {
		fail(400, "invalid_media", "文件内容与媒体类型不匹配或格式无法识别，请重新选择原件"); return
	}
	asset.MimeType = actual
	if asset.Kind == "image" {
		if file, openErr := os.Open(name); openErr == nil {
			config, _, decodeErr := image.DecodeConfig(file)
			file.Close()
			if decodeErr == nil { asset.Width, asset.Height = config.Width, config.Height }
		}
	}
	result := a.db.Model(&Asset{}).Where("id = ? AND delete_state = ? AND save_state = ?", asset.ID, "", "saving").Updates(map[string]any{"save_state": "saved", "mime_type": asset.MimeType, "bytes": asset.Bytes, "width": asset.Width, "height": asset.Height, "error": ""})
	if result.Error != nil { respondError(c, problem(500, "metadata_failed", "原件已写入，但资产记录保存失败，请检查服务器")); return }
	if result.RowsAffected == 0 { respondError(c, problem(410, "asset_deleted", "上传期间资产已被删除，文件将按删除流程清理")); return }
	if err := a.db.First(&asset, "id = ?", asset.ID).Error; err != nil { respondError(c, err); return }
	if asset.DeleteState != "" { respondError(c, problem(410, "asset_deleted", "上传期间资产已被删除，文件将按删除流程清理")); return }
	c.JSON(201, asset)
}

func (a *App) assetFile(c *gin.Context) {
	var asset Asset
	if err := a.db.First(&asset, "id = ? AND user_id = ?", c.Param("id"), currentUser(c).ID).Error; err != nil { respondError(c, err); return }
	if asset.DeleteState != "" { respondError(c, problem(410, "asset_deleted", "资产已删除")); return }
	if asset.SaveState != "saved" { respondError(c, problem(409, "asset_not_saved", "文件尚未可靠保存")); return }
	select {
	case a.transfers <- struct{}{}:
		defer func() { <-a.transfers }()
	case <-c.Request.Context().Done():
		return
	}
	if err := a.db.First(&asset, "id = ? AND user_id = ?", asset.ID, currentUser(c).ID).Error; err != nil { respondError(c, err); return }
	if asset.DeleteState != "" { respondError(c, problem(410, "asset_deleted", "资产已删除")); return }
	name, err := a.assetPath(asset.Path)
	if err != nil { respondError(c, err); return }
	file, err := os.Open(name)
	if err != nil { respondError(c, problem(500, "file_unavailable", "已保存文件暂时无法读取，请检查服务器磁盘")); return }
	defer file.Close()
	stat, err := file.Stat()
	if err != nil { respondError(c, err); return }
	c.Header("Content-Type", asset.MimeType)
	c.Header("Content-Disposition", mime.FormatMediaType("inline", map[string]string{"filename": asset.Title}))
	c.Header("Content-Security-Policy", "sandbox")
	http.ServeContent(c.Writer, c.Request, asset.Title, stat.ModTime(), file)
}

func (a *App) updateAsset(c *gin.Context) {
	var input struct { Title string `json:"title"`; Metadata JSON `json:"metadata"` }
	if !bind(c, &input) { return }
	if err := validTitle(input.Title); err != nil { respondError(c, err); return }
	if len(input.Metadata) == 0 { input.Metadata = JSON(`{}`) }
	err := a.db.Transaction(func(tx *gorm.DB) error {
		var asset Asset
		if err := tx.First(&asset, "id = ? AND user_id = ? AND delete_state = ?", c.Param("id"), currentUser(c).ID, "").Error; err != nil { return err }
		if err := validateAssetMetadata(tx, currentUser(c).ID, input.Metadata); err != nil { return err }
		return tx.Model(&asset).Updates(map[string]any{"title": strings.TrimSpace(input.Title), "metadata": input.Metadata}).Error
	})
	if err != nil { respondError(c, err); return }
	a.notify(currentUser(c).ID)
	c.Status(204)
}

func (a *App) createTextAsset(c *gin.Context) {
	var input struct { Title string `json:"title"`; Metadata JSON `json:"metadata"` }
	if !bind(c, &input) { return }
	if err := validTitle(input.Title); err != nil { respondError(c, err); return }
	asset := Asset{ID: identifier(), UserID: currentUser(c).ID, Kind: "text", Title: strings.TrimSpace(input.Title), Metadata: input.Metadata, SaveState: "saved", SyncState: "local"}
	err := a.db.Transaction(func(tx *gorm.DB) error {
		if err := validateAssetMetadata(tx, asset.UserID, asset.Metadata); err != nil { return err }
		return tx.Create(&asset).Error
	})
	if err != nil { respondError(c, err); return }
	a.notify(asset.UserID)
	c.JSON(201, asset)
}

func validateAssetMetadata(tx *gorm.DB, userID string, data JSON) error {
	var metadata map[string]any
	if json.Unmarshal(data, &metadata) != nil || metadata == nil { return problem(400, "invalid_metadata", "资产信息必须是对象") }
	if value, exists := metadata["coverUrl"]; exists { if _, ok := value.(string); !ok { return problem(400, "invalid_cover", "封面地址需要文本") } }
	for _, key := range []string{"source", "note", "content"} { if value, exists := metadata[key]; exists { if _, ok := value.(string); !ok && value != nil { return problem(400, "invalid_metadata", "资产说明需要文本") } } }
	if value, exists := metadata["tags"]; exists { tags, ok := value.([]any); if !ok { return problem(400, "invalid_metadata", "标签需要文本数组") }; for _, tag := range tags { if _, ok := tag.(string); !ok { return problem(400, "invalid_metadata", "标签需要文本数组") } } }
	cover, _ := metadata["coverUrl"].(string)
	if cover == "" { return nil }
	parts := strings.Split(strings.TrimPrefix(cover, "/api/assets/"), "/")
	if !strings.HasPrefix(cover, "/api/assets/") || len(parts) != 2 || (parts[1] != "file" && parts[1] != "preview") { return problem(400, "invalid_cover", "请上传封面并使用服务端资产地址") }
	var asset Asset
	if err := tx.First(&asset, "id = ? AND user_id = ? AND kind = ? AND save_state = ? AND delete_state = ?", parts[0], userID, "image", "saved", "").Error; err != nil { return problem(400, "invalid_cover", "封面不存在、已删除或无权访问") }
	return nil
}

func (a *App) retryAssetCleanup(c *gin.Context) {
	var asset Asset
	if err := a.db.First(&asset, "id = ? AND user_id = ? AND delete_state = ?", c.Param("id"), currentUser(c).ID, "pending").Error; err != nil { respondError(c, err); return }
	if err := a.cleanAsset(asset.ID); err != nil { respondError(c, problem(409, "cleanup_pending", "文件仍待清理，请检查服务器磁盘和目录权限")); return }
	c.Status(204)
}
