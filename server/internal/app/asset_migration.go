package app

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type AssetMigration struct {
	StorageID string `json:"storageId"`
	StorageName string `json:"storageName"`
	State string `json:"state"`
	Error string `json:"error,omitempty"`
}

type assetStorageOption struct {
	ID string `json:"id"`
	Name string `json:"name"`
	Default bool `json:"default"`
}

type assetMigrationInput struct {
	StorageID string `json:"storageId"`
	ExpectedUpdatedAt time.Time `json:"expectedUpdatedAt"`
}

// Asset users only need destination names, never endpoints or credentials.
func (a *App) AssetStorageOptions() ([]assetStorageOption, error) {
	rows := []assetStorageOption{}
	err := a.db.Model(&ObjectStorage{}).Select("id", "name", "default").Order("created_at").Find(&rows).Error
	return rows, err
}

func (a *App) assetStorageOptions(c *gin.Context) {
	rows, err := a.AssetStorageOptions(); if err != nil { respondError(c, err); return }; c.JSON(200, rows)
}

func (a *App) fillAssetStorage(assets []Asset) error {
	if len(assets) == 0 { return nil }
	ids := make([]string, 0, len(assets)); for _, asset := range assets { ids = append(ids, asset.ID) }
	var operations []FileOperation
	if err := a.db.Where("asset_id IN ? AND kind = ?", ids, "migrate").Find(&operations).Error; err != nil { return err }
	storages, err := a.AssetStorageOptions(); if err != nil { return err }
	names := map[string]string{}; for _, storage := range storages { names[storage.ID] = storage.Name }
	migrations := map[string]FileOperation{}; for _, operation := range operations { migrations[operation.AssetID] = operation }
	for index := range assets {
		asset := &assets[index]; asset.StorageName, asset.Migration = names[asset.StorageID], nil
		if operation, exists := migrations[asset.ID]; exists {
			state := operation.Stage; if operation.Error != "" { state = "failed" }
			asset.Migration = &AssetMigration{StorageID: operation.TargetStorageID, StorageName: names[operation.TargetStorageID], State: state, Error: operation.Error}
		}
	}
	return nil
}

func storageInUse(tx *gorm.DB, id string) (bool, error) {
	var count int64
	if err := tx.Model(&Asset{}).Where("storage_id = ? AND delete_state <> ?", id, "deleted").Count(&count).Error; err != nil { return false, err }
	if count > 0 { return true, nil }
	err := tx.Model(&FileOperation{}).Where("source_storage_id = ? OR target_storage_id = ?", id, id).Count(&count).Error
	return count > 0, err
}

func (a *App) migrateAsset(c *gin.Context) {
	var input assetMigrationInput; if !bind(c, &input) { return }
	if err := a.MigrateAsset(currentUser(c).ID, c.Param("id"), input); err != nil { respondError(c, err); return }; c.JSON(202, gin.H{"queued": true})
}

func (a *App) MigrateAsset(userID, id string, input assetMigrationInput) error {
	// Do not replace an upload that is already using this asset's file slot.
	a.workMu.Lock(); defer a.workMu.Unlock()
	err := a.db.Transaction(func(tx *gorm.DB) error {
		var asset Asset
		if err := tx.First(&asset, "id = ? AND user_id = ? AND delete_state = ?", id, userID, "").Error; err != nil { return err }
		if a.active["file:"+id] != nil { return problem(409, "asset_busy", "文件正在处理，请稍后重试") }
		if !asset.UpdatedAt.Equal(input.ExpectedUpdatedAt) { return problem(409, "asset_changed", "资产已更新，请重新读取后选择存储") }
		if asset.Kind == "text" || asset.SaveState != "saved" || asset.Path == "" { return problem(409, "asset_not_saved", "仅已可靠保存的媒体原件可以迁移") }
		var pending int64
		if err := tx.Model(&FileOperation{}).Where("asset_id = ? AND kind = ?", id, "migrate").Count(&pending).Error; err != nil { return err }
		if pending > 0 { return problem(409, "migration_pending", "已有迁移仍在处理中，请等待完成或重试当前迁移") }
		var target ObjectStorage
		if err := tx.First(&target, "id = ?", input.StorageID).Error; err != nil { return err }
		if target.ID == asset.StorageID { return problem(400, "same_storage", "请选择其他存储配置") }
		if asset.StorageID != "" {
			var source ObjectStorage; if err := tx.First(&source, "id = ?", asset.StorageID).Error; err != nil { return err }
			if strings.EqualFold(strings.TrimSuffix(source.Endpoint, "/"), strings.TrimSuffix(target.Endpoint, "/")) && source.Bucket == target.Bucket { return problem(400, "same_storage", "两份配置指向同一个存储桶，无需迁移") }
		}
		if err := tx.Delete(&FileOperation{}, "asset_id = ? AND kind = ?", id, "sync").Error; err != nil { return err }
		if err := tx.Create(&FileOperation{ID: identifier(), AssetID: id, Kind: "migrate", SourceStorageID: asset.StorageID, TargetStorageID: target.ID, Stage: "pending"}).Error; err != nil { return err }
		return tx.Model(&asset).Update("updated_at", time.Now()).Error
	})
	if err == nil { a.logEvent(a.ctx, slog.LevelInfo, "asset.migration_queued", slog.String("user_id", userID), slog.String("asset_id", id)); a.notify(userID); a.signalWork() }
	return err
}

func (a *App) RetryAssetSync(userID, id string) error {
	var asset Asset
	if err := a.db.First(&asset, "id = ? AND user_id = ? AND delete_state = ? AND save_state = ?", id, userID, "", "saved").Error; err != nil { return err }
	if err := a.queueAssetSync(id); err != nil { return err }
	if err := a.db.Model(&FileOperation{}).Where("asset_id = ? AND kind IN ?", id, []string{"sync", "migrate"}).Update("next_run_at", nil).Error; err != nil { return err }
	a.signalWork(); a.notify(userID); return nil
}

// Every stage is durable. A retry copies the same original to the same key;
// the old location remains authoritative until no task can hold its signed URL.
func (a *App) runAssetMigration(ctx context.Context, operation FileOperation, policy executionPolicy) (bool, error) {
	release, err := a.acquireFile(ctx, false, false); if err != nil { return false, err }; defer release()
	a.assetFiles.RLock(); defer a.assetFiles.RUnlock()
	var asset Asset
	if err := a.db.First(&asset, "id = ?", operation.AssetID).Error; err != nil { return false, err }
	if asset.DeleteState != "" {
		if asset.DeleteState != "pending" || asset.SyncState == "synced" { return false, nil }
		var active int64; if err := a.db.Model(&TaskAsset{}).Where("asset_id = ? AND released = ?", asset.ID, false).Count(&active).Error; err != nil { return false, err }
		if active == 0 { return false, nil }
		// Accepted tasks may still need the upload after deletion was requested.
	}
	if operation.Stage == "pending" || operation.Stage == "copy" {
		if err := a.db.Model(&operation).Updates(map[string]any{"stage": "copy", "error": ""}).Error; err != nil { return false, err }; a.notify(asset.UserID)
		target := asset; target.StorageID = operation.TargetStorageID
		name, err := a.assetOriginalPath(asset); if err != nil { return false, err }
		file, err := os.Open(name); if err != nil { return false, err }
		info, err := file.Stat(); if err != nil { file.Close(); return false, err }
		if info.Size() != asset.Bytes { file.Close(); return false, problem(409, "asset_size_changed", "服务器原件大小与资产记录不符，请检查文件完整性；未切换存储") }
		err = a.putCloudAsset(ctx, target, file, policy); file.Close(); if err != nil { return false, err }
		if err := a.db.Model(&operation).Updates(map[string]any{"stage": "switch", "error": ""}).Error; err != nil { return false, err }
		operation.Stage = "switch"
	}
	if operation.Stage == "switch" {
		waiting := false
		err := a.db.Transaction(func(tx *gorm.DB) error {
			if err := tx.First(&asset, "id = ?", asset.ID).Error; err != nil { return err }
			if asset.DeleteState != "" {
				var active int64; if err := tx.Model(&TaskAsset{}).Where("asset_id = ? AND released = ?", asset.ID, false).Count(&active).Error; err != nil { return err }
				if asset.DeleteState != "pending" || asset.SyncState == "synced" || active == 0 { waiting = true; return nil }
			}
			if asset.SyncState == "synced" && operation.SourceStorageID != "" {
				var active int64; if err := tx.Model(&TaskAsset{}).Where("asset_id = ? AND released = ?", asset.ID, false).Count(&active).Error; err != nil { return err }
				if active > 0 { waiting = true; return tx.Model(&operation).Updates(map[string]any{"next_run_at": time.Now().Add(seconds(policy.PollSeconds)), "error": ""}).Error }
			}
			if err := tx.Model(&asset).Updates(map[string]any{"storage_id": operation.TargetStorageID, "sync_state": "synced", "error": ""}).Error; err != nil { return err }
			return tx.Model(&operation).Updates(map[string]any{"stage": "cleanup", "next_run_at": nil, "error": ""}).Error
		})
		if err != nil || waiting { a.notify(asset.UserID); return false, err }
		operation.Stage = "cleanup"; a.notify(asset.UserID); a.refreshTaskSync(asset.ID); a.signalWork()
	}
	if asset.DeleteState != "" { return false, nil } // Global cleanup owns both locations.
	if operation.Stage != "cleanup" { return false, errors.New("invalid migration stage") }
	if err := a.db.Model(&operation).Update("error", "").Error; err != nil { return false, err }; a.notify(asset.UserID)
	source := asset; source.StorageID = operation.SourceStorageID
	if err := a.deleteCloudAsset(ctx, source, policy); err != nil { return false, err }
	return true, nil
}
