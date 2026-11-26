package app

import (
	"encoding/json"
	"errors"
	"fmt"
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
	_ "golang.org/x/image/webp"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func (a *App) listAssets(c *gin.Context) {
	userID := currentUser(c).ID
	if c.Query("deleting") != "true" {
		assets, err := a.ListLibraryAssets(userID, c.Query("assetProjectId"))
		if err != nil { respondError(c, err); return }
		c.JSON(200, assets)
		return
	}
	assets := []Asset{}
	if err := a.db.Where("user_id = ? AND delete_state = ?", userID, "pending").Order("created_at DESC").Find(&assets).Error; err != nil { respondError(c, err); return }
	for index := range assets { if err := assetCleanupBlocker(a.db, &assets[index]); err != nil { respondError(c, err); return } }
	if err := a.fillAssetStorage(assets); err != nil { respondError(c, err); return }
	c.JSON(200, assets)
}

func (a *App) ListLibraryAssets(userID, assetProjectID string) ([]Asset, error) {
	assets := []Asset{}
	query := a.db.Where("user_id = ? AND delete_state = ? AND workbench_record_id = ?", userID, "", "")
	if assetProjectID != "" {
		if err := ensureAssetProject(a.db, userID, assetProjectID); err != nil { return nil, err }
		query = query.Where("asset_project_id = ?", assetProjectID)
	}
	if err := query.Order("created_at DESC").Find(&assets).Error; err != nil { return nil, err }
	return assets, a.fillAssetStorage(assets)
}

func (a *App) getAsset(c *gin.Context) {
	var asset Asset
	if err := a.db.First(&asset, "id = ? AND user_id = ?", c.Param("id"), currentUser(c).ID).Error; err != nil { respondError(c, err); return }
	if err := assetCleanupBlocker(a.db, &asset); err != nil { respondError(c, err); return }
	rows := []Asset{asset}; if err := a.fillAssetStorage(rows); err != nil { respondError(c, err); return }; asset = rows[0]
	c.JSON(200, asset)
}

// A raw upload streams directly to its final persistent path. It is never a multipart temp file.
func (a *App) uploadAsset(c *gin.Context) {
	release, err := a.acquireFile(c.Request.Context(), false, false); if err != nil { return }; defer release()
	a.assetFiles.RLock(); defer a.assetFiles.RUnlock()
	mimeType, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
	if err != nil || (!strings.HasPrefix(mimeType, "image/") && !strings.HasPrefix(mimeType, "video/") && !strings.HasPrefix(mimeType, "audio/")) {
		respondError(c, problem(400, "invalid_media", "只支持图片、视频和音频原件")); return
	}
	kind := strings.Split(mimeType, "/")[0]
	limit := suggestedPolicy().mediaLimit(kind)
	if policy, err := a.executionPolicy(); err == nil && policy.mediaLimit(kind) > 0 { limit = policy.mediaLimit(kind) }
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, limit)
	source, detected, err := assetMediaSource(c.Request.Body)
	if err != nil {
		var limit *http.MaxBytesError
		if errors.As(err, &limit) { respondError(c, problem(413, "media_too_large", "原件超过管理员配置的大小限制，未修改原件，请重新选择")); return }
		respondError(c, problem(500, "save_failed", "文件类型读取失败，尚未完成资产保存，请重新上传")); return
	}
	actual, _, err := mime.ParseMediaType(detected.String())
	audioContainer := mimeType == "audio/webm" && actual == "video/webm" || mimeType == "audio/mp4" && actual == "video/mp4"
	if err != nil || (!strings.HasPrefix(actual, kind+"/") && !audioContainer) || detected.Extension() == "" { respondError(c, problem(400, "invalid_media", "文件内容与媒体类型不匹配或格式无法识别，请重新选择原件")); return }
	id := identifier()
	title, _ := url.QueryUnescape(c.GetHeader("X-File-Name"))
	assetProjectID := c.GetHeader("X-Asset-Project")
	if assetProjectID == "" { assetProjectID = defaultAssetProjectID }
	asset := Asset{ID: id, UserID: currentUser(c).ID, AssetProjectID: assetProjectID, Kind: kind, Title: title, MimeType: actual, WorkbenchRecordID: strings.TrimSpace(c.GetHeader("X-Workbench-Record")), Path: id+detected.Extension(), SaveState: "saving", SyncState: "local", Metadata: JSON(`{}`)}
	name, err := a.assetOriginalPath(asset)
	if err != nil { respondError(c, err); return }
	if asset.Title == "" { asset.Title = "未命名素材" }
	if err := a.db.Transaction(func(tx *gorm.DB) error {
		if err := ensureAssetProject(tx, asset.UserID, asset.AssetProjectID); err != nil { return err }
		if asset.WorkbenchRecordID != "" { var removed int64; if err := tx.Model(&WorkbenchRecord{}).Where("user_id = ? AND id = ? AND removed = ?", asset.UserID, asset.WorkbenchRecordID, true).Count(&removed).Error; err != nil { return err }; if removed > 0 { return problem(409, "record_removed", "生成记录已删除，请新建后上传") } }
		return tx.Create(&asset).Error
	}); err != nil { respondError(c, err); return }
	defer a.notify(asset.UserID)
	fail := func(status int, code, message string) {
		if err := a.db.Model(&Asset{}).Where("id = ? AND save_state = ?", asset.ID, "saving").Updates(map[string]any{"save_state": "failed", "bytes": asset.Bytes, "error": message}).Error; err != nil { respondError(c, problem(500, "metadata_failed", "文件保存未完成，且失败状态记录失败，请检查服务器磁盘与数据库")); return }
		respondError(c, problem(status, code, message))
	}
	file, err := os.OpenFile(name, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err == nil {
		asset.Bytes, err = io.Copy(file, source)
		if err == nil { err = file.Sync() }
		closeErr := file.Close()
		if err == nil { err = closeErr }
	}
	if err == nil && asset.Bytes == 0 { err = errors.New("empty media") }
	if err != nil {
		var limit *http.MaxBytesError
		if errors.As(err, &limit) { fail(413, "media_too_large", "原件超过管理员配置的大小限制，未修改原件，请重新选择"); return }
		fail(500, "save_failed", "文件未能完整写入持久目录，尚未可靠保留，请重新上传"); return
	}
	if asset.Kind == "image" {
		if file, openErr := os.Open(name); openErr == nil {
			config, _, decodeErr := image.DecodeConfig(file)
			file.Close()
			if decodeErr == nil { asset.Width, asset.Height = config.Width, config.Height }
		}
	}
	audioOnly := false
	if policy, err := a.executionPolicy(); err == nil { audioOnly = a.probeMedia(c.Request.Context(), &asset, policy) } else if audioContainer { fail(503, "media_probe_failed", "录音已写入，但运行参数尚未就绪，无法核实音轨，请保留录音后重试"); return }
	if audioContainer {
		if asset.ProbeError != "" { fail(422, "media_probe_failed", "录音尚未完成资产保存，无法核实音轨："+asset.ProbeError); return }
		if !audioOnly { fail(400, "invalid_media", "文件不包含纯音频，不能作为录音保存"); return }
		asset.MimeType = mimeType
	}
	result := a.db.Model(&Asset{}).Where("id = ? AND delete_state = ? AND save_state = ?", asset.ID, "", "saving").Updates(map[string]any{"save_state": "saved", "mime_type": asset.MimeType, "bytes": asset.Bytes, "width": asset.Width, "height": asset.Height, "duration_ms": asset.DurationMS, "fps": asset.FPS, "video_codec": asset.VideoCodec, "audio_codec": asset.AudioCodec, "probe_error": asset.ProbeError, "error": ""})
	if result.Error != nil { respondError(c, problem(500, "metadata_failed", "原件已写入，但资产记录保存失败，请检查服务器")); return }
	if result.RowsAffected == 0 { respondError(c, problem(410, "asset_deleted", "上传期间资产已被删除，文件将按删除流程清理")); return }
	if err := a.db.First(&asset, "id = ?", asset.ID).Error; err != nil { respondError(c, err); return }
	if asset.DeleteState != "" { respondError(c, problem(410, "asset_deleted", "上传期间资产已被删除，文件将按删除流程清理")); return }
	if err := a.queueAssetSync(asset.ID); err != nil { respondError(c, problem(500, "sync_record_failed", "原件已保存，但云同步记录写入失败，请检查数据库")); return }
	if err := a.db.First(&asset, "id = ?", asset.ID).Error; err != nil { respondError(c, err); return }
	c.JSON(201, asset)
}

func (a *App) retryAssetSync(c *gin.Context) {
	if err := a.RetryAssetSync(currentUser(c).ID, c.Param("id")); err != nil { respondError(c, err); return }; c.Status(204)
}

func (a *App) assetFile(c *gin.Context) {
	var asset Asset
	if err := a.db.First(&asset, "id = ? AND user_id = ?", c.Param("id"), currentUser(c).ID).Error; err != nil { respondError(c, err); return }
	if asset.DeleteState != "" { respondError(c, problem(410, "asset_deleted", "资产已删除")); return }
	if asset.SaveState != "saved" { respondError(c, problem(409, "asset_not_saved", "文件尚未可靠保存")); return }
	release, err := a.acquireFile(c.Request.Context(), false, false); if err != nil { return }; defer release()
	a.assetFiles.RLock(); defer a.assetFiles.RUnlock()
	if err := a.db.First(&asset, "id = ? AND user_id = ?", asset.ID, currentUser(c).ID).Error; err != nil { respondError(c, err); return }
	if asset.DeleteState != "" { respondError(c, problem(410, "asset_deleted", "资产已删除")); return }
	name, err := a.assetOriginalPath(asset)
	if err != nil { respondError(c, err); return }
	file, err := os.Open(name)
	if err != nil { respondError(c, problem(500, "file_unavailable", "已保存文件暂时无法读取，请检查服务器磁盘")); return }
	defer file.Close()
	stat, err := file.Stat()
	if err != nil { respondError(c, err); return }
	c.Header("Content-Type", asset.MimeType)
	c.Header("Content-Disposition", mime.FormatMediaType("inline", map[string]string{"filename": asset.Title}))
	c.Header("Content-Security-Policy", "sandbox")
	c.Header("Cache-Control", "private, max-age=86400")
	c.Header("ETag", fmt.Sprintf("\"%s-%d-%d\"", asset.ID, stat.Size(), stat.ModTime().UnixNano()))
	http.ServeContent(c.Writer, c.Request, asset.Title, stat.ModTime(), file)
}

type assetSaveInput struct {
	Title string `json:"title"`
	Metadata JSON `json:"metadata"`
}

func (a *App) updateAsset(c *gin.Context) {
	var input struct {
		assetSaveInput
		ExpectedAssetProjectID *string `json:"expectedAssetProjectId"`
	}
	if !bind(c, &input) { return }
	if err := a.updateAssetMetadata(currentUser(c).ID, c.Param("id"), input.Title, input.Metadata, input.ExpectedAssetProjectID); err != nil { respondError(c, err); return }; c.Status(204)
}

func (a *App) UpdateAsset(userID, id, title string, metadata JSON) error {
	return a.updateAssetMetadata(userID, id, title, metadata, nil)
}

func (a *App) updateAssetMetadata(userID, id, title string, metadata JSON, expectedAssetProjectID *string) error {
	if err := validTitle(title); err != nil { return err }
	if len(metadata) == 0 { metadata = JSON(`{}`) }
	err := a.db.Transaction(func(tx *gorm.DB) error {
		var asset Asset
		if err := tx.First(&asset, "id = ? AND user_id = ? AND delete_state = ?", id, userID, "").Error; err != nil { return err }
		if expectedAssetProjectID != nil && asset.AssetProjectID != *expectedAssetProjectID { return problem(409, "asset_project_changed", "资产已移动，请重新读取后操作") }
		metadata, err := validateAssetMetadata(tx, userID, metadata); if err != nil { return err }
		return tx.Model(&asset).Updates(map[string]any{"title": strings.TrimSpace(title), "metadata": metadata, "workbench_record_id": ""}).Error
	})
	if err == nil { a.notify(userID) }; return err
}

func (a *App) createTextAsset(c *gin.Context) {
	var input struct {
		assetSaveInput
		AssetProjectID *string `json:"assetProjectId"`
	}
	if !bind(c, &input) { return }
	assetProjectID := defaultAssetProjectID
	if input.AssetProjectID != nil { assetProjectID = *input.AssetProjectID }
	asset, err := a.CreateTextAsset(currentUser(c).ID, input.Title, input.Metadata, assetProjectID)
	if err != nil { respondError(c, err); return }; c.JSON(201, asset)
}

func (a *App) CreateTextAsset(userID, title string, metadata JSON, assetProjectID string) (Asset, error) {
	if err := validTitle(title); err != nil { return Asset{}, err }
	asset := Asset{ID: identifier(), UserID: userID, AssetProjectID: assetProjectID, Kind: "text", Title: strings.TrimSpace(title), Metadata: metadata, SaveState: "saved", SyncState: "local"}
	err := a.db.Transaction(func(tx *gorm.DB) error {
		if err := ensureAssetProject(tx, userID, assetProjectID); err != nil { return err }
		metadata, err := validateAssetMetadata(tx, asset.UserID, asset.Metadata); if err != nil { return err }; asset.Metadata = metadata
		return tx.Create(&asset).Error
	})
	if err == nil { a.notify(asset.UserID) }; return asset, err
}

func assetMetadata(data JSON) (map[string]json.RawMessage, error) {
	var metadata map[string]json.RawMessage
	if json.Unmarshal(data, &metadata) != nil || metadata == nil { return nil, problem(400, "invalid_metadata", "资产信息必须是对象") }
	delete(metadata, "tags")
	return metadata, nil
}

func validateAssetMetadata(tx *gorm.DB, userID string, data JSON) (JSON, error) {
	metadata, err := assetMetadata(data); if err != nil { return nil, err }
	cover := ""
	if value, exists := metadata["coverUrl"]; exists { var text *string; if json.Unmarshal(value, &text) != nil || text == nil { return nil, problem(400, "invalid_cover", "封面地址需要文本") }; cover = *text }
	for _, key := range []string{"source", "note", "content"} { if value, exists := metadata[key]; exists { var text *string; if json.Unmarshal(value, &text) != nil { return nil, problem(400, "invalid_metadata", "资产说明需要文本") } } }
	if cover == "" { return encode(metadata), nil }
	parts := strings.Split(strings.TrimPrefix(cover, "/api/assets/"), "/")
	if !strings.HasPrefix(cover, "/api/assets/") || len(parts) != 2 || (parts[1] != "file" && parts[1] != "preview") { return nil, problem(400, "invalid_cover", "请上传封面并使用服务端资产地址") }
	var asset Asset
	if err := tx.First(&asset, "id = ? AND user_id = ? AND kind = ? AND save_state = ? AND delete_state = ?", parts[0], userID, "image", "saved", "").Error; err != nil { return nil, problem(400, "invalid_cover", "封面不存在、已删除或无权访问") }
	return encode(metadata), nil
}

type assetDeleteResult struct { AssetID string `json:"assetId"`; DeleteState string `json:"deleteState"` }
type assetCleanupInput struct { RetainCloud bool `json:"retainCloud"`; Confirmed bool `json:"confirmed"` }

func (a *App) DeleteAsset(userID, id string) (assetDeleteResult, error) {
	var asset Asset
	err := a.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.First(&asset, "id = ? AND user_id = ?", id, userID).Error; err != nil { return err }
		if asset.DeleteState == "deleted" { return nil }
		if asset.DeleteState == "" {
			if err := tx.Model(&asset).Updates(map[string]any{"delete_state": "pending", "error": ""}).Error; err != nil { return err }
			asset.DeleteState = "pending"
		}
		return queueAssetCleanup(tx, asset.ID)
	})
	if err == nil { a.notify(userID); a.signalWork() }
	return assetDeleteResult{AssetID: asset.ID, DeleteState: asset.DeleteState}, err
}

func (a *App) deleteAsset(c *gin.Context) {
	result, err := a.DeleteAsset(currentUser(c).ID, c.Param("id"))
	if err != nil { respondError(c, err); return }
	status := 202; if result.DeleteState == "deleted" { status = 200 }
	c.JSON(status, result)
}

func (a *App) retryAssetCleanup(c *gin.Context) {
	var input assetCleanupInput
	if c.Request.ContentLength != 0 && !bind(c, &input) { return }
	if err := a.RetryAssetCleanup(currentUser(c).ID, c.Param("id"), input); err != nil { respondError(c, err); return }
	c.JSON(202, gin.H{"deleteState": "pending"})
}

func queueAssetCleanup(db *gorm.DB, id string) error {
	return db.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "asset_id"}, {Name: "kind"}}, DoNothing: true}).Create(&FileOperation{ID: identifier(), AssetID: id, Kind: "delete"}).Error
}

func (a *App) RetryAssetCleanup(userID, id string, input assetCleanupInput) error {
	if input.RetainCloud {
		if !input.Confirmed { return problem(400, "confirmation_required", "请确认仅删除本地文件和应用内存储关联，云端对象将保留且不再由应用清理") }
		// Serialize with file dispatch so an active cloud operation cannot
		// finish using the previous intent after this request is accepted.
		a.workMu.Lock(); defer a.workMu.Unlock()
	}
	err := a.db.Transaction(func(tx *gorm.DB) error {
		var asset Asset
		if err := tx.First(&asset, "id = ? AND user_id = ? AND delete_state = ?", id, userID, "pending").Error; err != nil { return err }
		if input.RetainCloud {
			if a.active["file:"+id] != nil { return problem(409, "asset_busy", "文件正在处理，请等待当前操作结束后重试仅本地清理") }
			if err := tx.Model(&asset).Updates(map[string]any{"retain_cloud": true, "error": ""}).Error; err != nil { return err }
		}
		if err := queueAssetCleanup(tx, asset.ID); err != nil { return err }
		return tx.Model(&FileOperation{}).Where("asset_id = ? AND kind = ?", asset.ID, "delete").Update("next_run_at", nil).Error
	})
	if err == nil { a.notify(userID); a.signalWork() }
	return err
}

func assetCleanupBlocker(db *gorm.DB, asset *Asset) error {
	if asset.DeleteState != "pending" { return nil }
	var task GenerationTask
	err := db.Select("id", "status").Where("user_id = ? AND EXISTS (SELECT 1 FROM task_assets WHERE task_assets.task_id = generation_tasks.id AND task_assets.asset_id = ? AND released = ?)", asset.UserID, asset.ID, false).Order("created_at").Take(&task).Error
	if err == nil {
		asset.CleanupTaskID = task.ID
		asset.Error = "生成任务 "+task.ID+" 尚未结束，仍占用此素材；任务结束后自动清理"
		if task.Status == "confirmation_required" { asset.Error = "生成任务 "+task.ID+" 待人工核对，仍占用此素材；请在生成任务中核对结果后继续清理" }
		return nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) { return err }
	var active int64
	if err := db.Model(&TaskAsset{}).Where("asset_id = ? AND released = ?", asset.ID, false).Count(&active).Error; err != nil { return err }
	if active > 0 { asset.Error = "等待使用该素材的任务结束并释放占用后清理" }
	return nil
}
