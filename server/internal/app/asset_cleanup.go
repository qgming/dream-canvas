package app

import (
	"context"
	"errors"
	"os"

	"gorm.io/gorm"
)

func (a *App) cleanAsset(id string) error {
	var asset Asset
	if err := a.db.First(&asset, "id = ?", id).Error; err != nil { return err }
	defer a.notify(asset.UserID)
	if asset.DeleteState == "deleted" { return nil }
	if asset.DeleteState != "pending" { return problem(409, "not_deleting", "资产尚未标记删除") }
	var active int64
	if err := a.db.Model(&TaskAsset{}).Where("asset_id = ? AND released = ?", asset.ID, false).Count(&active).Error; err != nil { return err }
	if active > 0 { a.db.Model(&asset).Update("error", "等待使用该素材的任务结束后清理"); return problem(409, "asset_in_use", "等待任务结束后清理") }
	var responseCopies int64
	if err := a.db.Model(&GenerationTask{}).Where("response_cleanup_pending = ? AND EXISTS (SELECT 1 FROM task_assets WHERE task_assets.task_id = generation_tasks.id AND task_assets.asset_id = ?)", true, asset.ID).Count(&responseCopies).Error; err != nil { return err }
	if responseCopies > 0 { a.db.Model(&asset).Update("error", "等待供应商响应中的媒体副本清理后完成全局删除"); return problem(409, "response_cleanup_pending", "仍有供应商响应副本待清理") }
	if asset.Path == "" { return a.db.Model(&asset).Update("delete_state", "deleted").Error }
	// Wait for uploads and original reads before unlinking their persistent files.
	release, err := a.acquireFile(a.ctx, false, false); if err != nil { return err }; defer release()
	releasePreview, err := a.acquireFile(a.ctx, true, false); if err != nil { return err }; defer releasePreview()
	a.assetFiles.Lock(); defer a.assetFiles.Unlock()
	if err := a.db.First(&asset, "id = ?", id).Error; err != nil { return err }
	if asset.DeleteState == "deleted" { return nil }
	if asset.StorageID != "" {
		policy, err := a.executionPolicy()
		if err != nil { return err }
		ctx, cancel := context.WithTimeout(a.ctx, seconds(policy.TransferSeconds))
		err = a.deleteCloudAsset(ctx, asset, policy); cancel()
		if err != nil { a.db.Model(&asset).Update("error", "云端副本删除失败，仍在处理中，本地原件暂时保留"); return err }
	}
	var migrations []FileOperation
	if err := a.db.Where("asset_id = ? AND kind = ?", asset.ID, "migrate").Find(&migrations).Error; err != nil { return err }
	for _, migration := range migrations {
		policy, err := a.executionPolicy(); if err != nil { return err }
		for _, storageID := range []string{migration.SourceStorageID, migration.TargetStorageID} {
			if storageID == "" || storageID == asset.StorageID { continue }
			copy := asset; copy.StorageID = storageID
			ctx, cancel := context.WithTimeout(a.ctx, seconds(policy.TransferSeconds)); err := a.deleteCloudAsset(ctx, copy, policy); cancel()
			if err != nil { a.db.Model(&asset).Update("error", "迁移副本仍待删除，本地原件暂时保留"); return err }
		}
	}
	if asset.Kind == "image" || asset.Kind == "video" {
		preview, err := a.previewPath(asset.ID)
		if err == nil { err = os.Remove(preview) }
		if err != nil && !errors.Is(err, os.ErrNotExist) { a.db.Model(&asset).Update("error", "缩略图清理失败，请检查目录权限后重试"); return err }
	}
	name, err := a.assetOriginalPath(asset)
	if err == nil { err = os.Remove(name) }
	if errors.Is(err, os.ErrNotExist) { err = nil }
	if err != nil {
		a.db.Model(&asset).Update("error", "文件清理失败，请检查目录权限和磁盘状态后重试")
		return err
	}
	return a.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Delete(&FileOperation{}, "asset_id = ? AND kind IN ?", asset.ID, []string{"sync", "migrate"}).Error; err != nil { return err }
		return tx.Model(&asset).Updates(map[string]any{"delete_state": "deleted", "error": ""}).Error
	})
}
