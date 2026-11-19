package app

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"mime"
	"os"
	"strings"
	"time"

	"github.com/gabriel-vasile/mimetype"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var errAssetRepairWaiting = errors.New("asset filename repair is waiting for task leases")

type assetFilenameRepairItem struct { AssetID string `json:"assetId"`; Title string `json:"title"`; State string `json:"state"`; Error string `json:"error"`; Changed bool `json:"changed"` }

func claimTaskAsset(database *gorm.DB, reference TaskAsset) error {
	var active int64
	if err := database.Model(&FileOperation{}).Where("asset_id = ? AND kind = ? AND state = ?", reference.AssetID, "repair_suffix", "running").Count(&active).Error; err != nil { return err }
	if active > 0 { return problem(409, "asset_filename_repairing", "素材正在修复文件后缀，请完成后重新提交；本次未提交供应商") }
	return database.FirstOrCreate(&reference).Error
}

func (application *App) queueAssetFilenameRepair(request *gin.Context) {
	var input struct { Confirmed bool `json:"confirmed"` }
	if !bind(request, &input) { return }
	queued, err := application.QueueAssetFilenameRepair(currentUser(request), input.Confirmed)
	if err != nil { respondError(request, err); return }
	request.JSON(202, gin.H{"queued": queued})
}

func (application *App) QueueAssetFilenameRepair(user User, confirmed bool) (int, error) {
	if !confirmed { return 0, problem(400, "confirmation_required", "请确认修复当前账号历史媒体的本地及云端文件名") }
	if _, err := application.executionPolicy(); err != nil { return 0, err }
	queued := 0
	err := application.db.Transaction(func(database *gorm.DB) error {
		if err := database.First(&user, "id = ? AND role = ? AND disabled = ?", user.ID, "admin", false).Error; err != nil { return problem(403, "forbidden", "需要管理员权限") }
		var assets []Asset
		if err := database.Select("id", "path").Where("user_id = ? AND kind IN ? AND save_state = ? AND delete_state = ?", user.ID, []string{"image", "video", "audio"}, "saved", "").Find(&assets).Error; err != nil { return err }
		for _, asset := range assets {
			operation := FileOperation{ID: identifier(), AssetID: asset.ID, Kind: "repair_suffix", State: "queued", SourcePath: asset.Path}
			result := database.Clauses(clause.OnConflict{DoNothing: true}).Create(&operation)
			if result.Error != nil { return result.Error }; queued += int(result.RowsAffected)
		}
		return database.Model(&FileOperation{}).Where("kind = ? AND state <> ? AND asset_id IN (?)", "repair_suffix", "done", database.Model(&Asset{}).Select("id").Where("user_id = ?", user.ID)).Update("next_run_at", nil).Error
	})
	if err == nil { application.signalWork(); application.notify(user.ID) }
	return queued, err
}

func (application *App) assetFilenameRepairStatus(request *gin.Context) {
	rows := []assetFilenameRepairItem{}
	err := application.db.Table("file_operations").Select("file_operations.asset_id, assets.title, file_operations.state, file_operations.error, (file_operations.state = 'done' AND file_operations.target_path <> file_operations.source_path) AS changed").Joins("JOIN assets ON assets.id = file_operations.asset_id").Where("file_operations.kind = ? AND assets.user_id = ?", "repair_suffix", currentUser(request).ID).Order("file_operations.created_at, file_operations.id").Scan(&rows).Error
	if err != nil { respondError(request, err); return }
	completed, changed, failed := 0, 0, 0
	for _, row := range rows { if row.State == "done" { completed++ }; if row.Changed { changed++ }; if row.Error != "" { failed++ } }
	request.JSON(200, gin.H{"total": len(rows), "completed": completed, "changed": changed, "failed": failed, "pending": len(rows)-completed, "items": rows})
}

func (application *App) runAssetFilenameRepair(ctx context.Context, operation FileOperation, policy executionPolicy) {
	var asset Asset
	if err := application.db.First(&asset, "id = ?", operation.AssetID).Error; err != nil { return }
	err := application.repairAssetFilename(ctx, &operation, policy)
	values := map[string]any{"state": "done", "error": "", "next_run_at": nil}
	if errors.Is(err, errAssetRepairWaiting) {
		values = map[string]any{"next_run_at": time.Now().Add(seconds(policy.PollSeconds)), "error": ""}
	} else if err != nil {
		application.logFailure(ctx, "asset.filename_repair_failed", err, slog.Int("attempt", operation.Attempts+1))
		index := operation.Attempts; if index >= len(policy.StorageRetrySeconds) { index = len(policy.StorageRetrySeconds)-1 }
		message := "文件后缀修复失败，原件及原引用仍保留，将按已有存储重试配置继续处理"
		if operation.State == "cleanup" { message = "正确后缀及引用已更新，旧副本清理失败，将继续清理" }
		var detail *Problem; if errors.As(err, &detail) { message = detail.Message }
		values = map[string]any{"attempts": operation.Attempts+1, "next_run_at": time.Now().Add(seconds(policy.StorageRetrySeconds[index])), "error": message}
		if operation.State == "running" { values["state"] = "queued" }
	} else { application.logEvent(ctx, slog.LevelInfo, "asset.filename_repair_completed") }
	if application.db.Model(&FileOperation{}).Where("id = ? AND state <> ?", operation.ID, "done").Updates(values).Error == nil { application.signalWork(); application.refreshTaskSync(asset.ID); application.notify(asset.UserID) }
}

func (application *App) repairAssetFilename(ctx context.Context, operation *FileOperation, policy executionPolicy) error {
	release, err := application.acquireFile(ctx, false, false); if err != nil { return err }; defer release()
	application.assetFiles.RLock()
	err = application.copyAssetFilename(ctx, operation, policy)
	application.assetFiles.RUnlock()
	if err != nil || operation.State != "cleanup" { return err }
	application.assetFiles.Lock(); defer application.assetFiles.Unlock()
	var asset Asset; if err := application.db.First(&asset, "id = ?", operation.AssetID).Error; err != nil { return err }
	if asset.Path != operation.TargetPath || operation.SourcePath == operation.TargetPath { return errors.New("asset filename changed before cleanup") }
	asset.Path = operation.SourcePath
	name, err := application.assetOriginalPath(asset); if err != nil { return err }
	if err := os.Remove(name); err != nil && !errors.Is(err, os.ErrNotExist) { return err }
	return nil
}

func (application *App) copyAssetFilename(ctx context.Context, operation *FileOperation, policy executionPolicy) error {
	if err := application.db.First(operation, "id = ?", operation.ID).Error; err != nil { return err }
	if operation.State == "done" { return nil }
	var asset Asset
	err := application.db.Transaction(func(database *gorm.DB) error {
		if err := database.First(&asset, "id = ? AND save_state = ? AND delete_state <> ?", operation.AssetID, "saved", "deleted").Error; err != nil { return err }
		if operation.State == "cleanup" { return nil }
		var active int64; if err := database.Model(&TaskAsset{}).Where("asset_id = ? AND released = ?", asset.ID, false).Count(&active).Error; err != nil { return err }; if active > 0 { return errAssetRepairWaiting }
		if asset.Path != operation.SourcePath { return errors.New("asset filename no longer matches repair source") }
		if err := database.Model(&FileOperation{}).Where("id = ?", operation.ID).Update("state", "running").Error; err != nil { return err }; operation.State = "running"; return nil
	})
	if err != nil { return err }
	if operation.State != "cleanup" && asset.DeleteState == "pending" {
		if operation.TargetPath != "" && operation.TargetPath != asset.Path {
			unused := asset; unused.Path = operation.TargetPath
			name, err := application.assetOriginalPath(unused); if err != nil { return err }
			if err := application.deleteCloudAsset(ctx, unused, policy); err != nil { return err }
			if err := os.Remove(name); err != nil && !errors.Is(err, os.ErrNotExist) { return err }
		}
		return application.db.Model(&FileOperation{}).Where("id = ?", operation.ID).Update("target_path", operation.SourcePath).Error
	}
	if operation.State != "cleanup" {
		name, err := application.assetOriginalPath(asset); if err != nil { return err }
		file, err := os.Open(name); if err != nil { return problem(409, "original_unavailable", "原件无法读取，未修改文件名；请检查服务器原件后重试") }; defer file.Close()
		info, err := file.Stat(); if err != nil { return err }; if !info.Mode().IsRegular() || info.Size() != asset.Bytes || info.Size() == 0 { return problem(409, "original_mismatch", "原件大小与资产记录不符，未修改原件，请先核对文件") }
		source, detected, err := assetMediaSource(file); if err != nil { return err }
		actual, _, err := mime.ParseMediaType(detected.String()); extension := detected.Extension()
		if asset.Kind == "audio" && asset.MimeType == "audio/pcm" && mimetype.EqualsAny(actual, "application/octet-stream", "text/plain") { actual, extension, err = "audio/pcm", ".pcm", nil }
		if err != nil || !strings.HasPrefix(actual, asset.Kind+"/") || extension == "" { return problem(409, "invalid_media", "无法识别原件的真实媒体格式，未修改原件，请核对后重试") }
		target := asset; target.Path, target.MimeType = asset.ID+extension, actual
		targetName, err := application.assetOriginalPath(target); if err != nil { return err }
		if operation.TargetPath != "" && operation.TargetPath != target.Path { return errors.New("detected repair format changed") }
		if operation.TargetPath == "" {
			if target.Path != asset.Path { if _, err := os.Lstat(targetName); err == nil { return problem(409, "target_exists", "目标文件已存在，未覆盖任何原件，请先核对服务器文件") } else if !errors.Is(err, os.ErrNotExist) { return err } }
			if err := application.db.Model(&FileOperation{}).Where("id = ?", operation.ID).Update("target_path", target.Path).Error; err != nil { return err }; operation.TargetPath = target.Path
		}
		if target.Path == asset.Path { return nil }
		if err := ctx.Err(); err != nil { return err }
		output, err := os.OpenFile(targetName, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0600); if err != nil { return err }
		count, err := io.Copy(output, source); if err == nil && count != asset.Bytes { err = errors.New("original changed during filename repair") }; if err == nil { err = output.Sync() }; closeErr := output.Close(); if err == nil { err = closeErr }; if err != nil { return err }
		if err := ctx.Err(); err != nil { return err }
		target.SyncState = "local"
		if asset.StorageID != "" {
			cloudFile, err := os.Open(targetName); if err != nil { return err }; err = application.putCloudAsset(ctx, target, cloudFile, policy); cloudFile.Close(); if err != nil { return err }; target.SyncState = "synced"
		}
		if err := application.db.Transaction(func(database *gorm.DB) error {
			result := database.Model(&Asset{}).Where("id = ? AND path = ? AND save_state = ? AND delete_state <> ?", asset.ID, operation.SourcePath, "saved", "deleted").Updates(map[string]any{"path": target.Path, "mime_type": target.MimeType, "sync_state": target.SyncState, "error": ""})
			if result.Error != nil { return result.Error }; if result.RowsAffected != 1 { return errors.New("asset changed before filename switch") }
			if target.SyncState == "synced" { if err := database.Where("asset_id = ? AND kind = ?", asset.ID, "sync").Delete(&FileOperation{}).Error; err != nil { return err } }
			return database.Model(&FileOperation{}).Where("id = ?", operation.ID).Update("state", "cleanup").Error
		}); err != nil { return err }
		operation.State = "cleanup"; asset = target
	}
	if asset.Path != operation.TargetPath || operation.SourcePath == operation.TargetPath { return errors.New("asset filename does not match cleanup target") }
	asset.Path = operation.SourcePath
	if _, err := application.assetOriginalPath(asset); err != nil { return err }
	return application.deleteCloudAsset(ctx, asset, policy)
}
