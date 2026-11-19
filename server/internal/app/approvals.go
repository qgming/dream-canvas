package app

import (
	"context"
	"errors"
	"os"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func (a *App) ListApprovals(userID string) ([]Approval, error) {
	approvals := []Approval{}
	err := a.db.Where("user_id = ?", userID).Order("created_at DESC").Find(&approvals).Error
	return approvals, err
}

func (a *App) listApprovals(c *gin.Context) {
	approvals, err := a.ListApprovals(currentUser(c).ID)
	if err != nil { respondError(c, err); return }
	c.JSON(200, approvals)
}

func (a *App) RequestApproval(userID, action, target string, version uint64) (Approval, error) {
	approval := Approval{ID: identifier(), UserID: userID, Action: action, TargetID: target, Version: version, Status: "pending"}
	var err error
	switch action {
	case "delete_project":
		var project Project
		err = a.db.First(&project, "id = ? AND user_id = ?", target, userID).Error
		if err == nil && project.Version != version { err = problem(409, "version_conflict", "项目已更新，请重新确认要删除的版本") }
	case "delete_asset":
		var asset Asset
		err = a.db.First(&asset, "id = ? AND user_id = ?", target, userID).Error
	default:
		err = problem(400, "invalid_action", "不支持的确认操作")
	}
	if err == nil { err = a.db.Create(&approval).Error }
	if err == nil { a.notify(userID) }
	return approval, err
}

func (a *App) createApproval(c *gin.Context) {
	var input struct { Action string `json:"action"`; TargetID string `json:"targetId"`; Version uint64 `json:"version"` }
	if !bind(c, &input) { return }
	approval, err := a.RequestApproval(currentUser(c).ID, input.Action, input.TargetID, input.Version)
	if err != nil { respondError(c, err); return }
	c.JSON(201, approval)
}

func (a *App) DecideApproval(userID, id string, accept bool) (Approval, error) {
	approval := Approval{}
	err := a.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.First(&approval, "id = ? AND user_id = ?", id, userID).Error; err != nil { return err }
		if approval.Status != "pending" { return nil }
		status := "declined"
		if accept {
			status = "accepted"
			switch approval.Action {
			case "delete_project":
				result := tx.Delete(&Project{}, "id = ? AND user_id = ? AND version = ?", approval.TargetID, approval.UserID, approval.Version)
				if result.Error != nil { return result.Error }
				if result.RowsAffected == 0 { return problem(409, "version_conflict", "项目已更新，请重新确认要删除的版本") }
				if err := tx.Delete(&AssetReference{}, "project_id = ?", approval.TargetID).Error; err != nil { return err }
				if err := tx.Delete(&ProjectRevision{}, "project_id = ?", approval.TargetID).Error; err != nil { return err }
			case "delete_asset":
				if err := tx.Model(&Asset{}).Where("id = ? AND user_id = ? AND delete_state = ?", approval.TargetID, approval.UserID, "").Updates(map[string]any{"delete_state": "pending", "error": ""}).Error; err != nil { return err }
				if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&FileOperation{ID: identifier(), AssetID: approval.TargetID, Kind: "delete"}).Error; err != nil { return err }
			default:
				return problem(400, "invalid_action", "不支持的确认操作")
			}
		}
		approval.Status = status
		return tx.Model(&approval).Update("status", status).Error
	})
	if err != nil { return approval, err }
	a.notify(userID)
	a.signalWork()
	return approval, nil
}

func (a *App) decideApproval(c *gin.Context) {
	var input struct { Accept bool `json:"accept"` }
	if !bind(c, &input) { return }
	approval, err := a.DecideApproval(currentUser(c).ID, c.Param("id"), input.Accept)
	var p *Problem
	if errors.As(err, &p) && p.Status == 202 { c.JSON(202, gin.H{"approval": approval, "deleteState": "pending", "message": p.Message}); return }
	if err != nil { respondError(c, err); return }
	c.JSON(200, approval)
}

func (a *App) cleanAsset(id string) error {
	var asset Asset
	if err := a.db.First(&asset, "id = ?", id).Error; err != nil { return err }
	defer a.notify(asset.UserID)
	if asset.DeleteState == "deleted" { return nil }
	if asset.DeleteState != "pending" { return problem(409, "not_deleting", "资产尚未确认删除") }
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
	if asset.Kind == "image" || asset.Kind == "video" {
		preview, err := a.previewPath(asset.ID)
		if err == nil { err = os.Remove(preview) }
		if err != nil && !errors.Is(err, os.ErrNotExist) { a.db.Model(&asset).Update("error", "缩略图清理失败，请检查目录权限后重试"); return err }
	}
	name, err := a.assetPath(asset.Path)
	if err == nil { err = os.Remove(name) }
	if errors.Is(err, os.ErrNotExist) { err = nil }
	if err != nil {
		a.db.Model(&asset).Update("error", "文件清理失败，请检查目录权限和磁盘状态后重试")
		return err
	}
	return a.db.Model(&asset).Updates(map[string]any{"delete_state": "deleted", "error": ""}).Error
}
