package app

import (
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type taskActionInput struct {
	ExpectedUpdatedAt time.Time `json:"expectedUpdatedAt"`
	Confirmed bool `json:"confirmed"`
	Status string `json:"status"`
	Note string `json:"note"`
}

func (a *App) resolveTask(c *gin.Context) {
	var input taskActionInput; if !bind(c, &input) { return }
	task, err := a.ResolveTask(currentUser(c).ID, c.Param("id"), input)
	if err != nil { respondError(c, err); return }; c.JSON(200, task)
}

// Manual resolution ends local reconciliation only. Saved outputs, snapshots and
// usage remain; response media copies follow the normal terminal cleanup path.
func (a *App) ResolveTask(userID, id string, input taskActionInput) (GenerationTask, error) {
	var task GenerationTask
	if !input.Confirmed { return task, problem(400, "confirmation_required", "请明确确认任务结果及释放素材占用") }
	if !includes([]string{"succeeded", "failed", "cancelled"}, input.Status) { return task, problem(400, "invalid_status", "请选择确认成功、确认失败或取消任务") }
	a.workMu.Lock()
	defer a.workMu.Unlock()
	err := a.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.First(&task, "id = ? AND user_id = ?", id, userID).Error; err != nil { return err }
		if !task.UpdatedAt.Equal(input.ExpectedUpdatedAt) { return problem(409, "task_changed", "任务已更新，请重新读取后核对") }
		if task.Removed || task.ResolvedAt != nil || !includes([]string{"confirmation_required", "interrupted"}, task.Status) { return problem(409, "resolution_unavailable", "仅待人工核对或中断的任务可手动确认结果") }
		if a.active["task:"+id] != nil || a.active["results:"+id] != nil { return problem(409, "task_busy", "任务仍在保存当前处理结果，请刷新后再确认") }
		ids := []string{}
		if len(task.AssetIDs) > 0 && json.Unmarshal(task.AssetIDs, &ids) != nil { return problem(409, "invalid_results", "任务成品记录无法读取，请保留记录") }
		if input.Status == "succeeded" {
			if task.SaveState != "saved" || task.Capability == "text" && strings.TrimSpace(task.Text) == "" || task.Capability != "text" && len(ids) == 0 { return problem(409, "result_not_saved", "尚无完整保存的成品，请先继续核对或恢复保存，不能直接标记成功") }
			for _, assetID := range ids {
				var asset Asset
				if err := tx.First(&asset, "id = ? AND user_id = ? AND save_state = ? AND delete_state = ?", assetID, userID, "saved", "").Error; err != nil {
					if errors.Is(err, gorm.ErrRecordNotFound) { return problem(409, "result_not_saved", "成品尚未完整保存或已申请删除，不能标记成功") }; return err
				}
			}
		}
		// A transfer may have saved some outputs before pausing. Retain their IDs
		// even when the full result set has not been committed to the task yet.
		var saved []Asset
		if err := tx.Where("user_id = ? AND save_state = ? AND id IN (?) AND json_extract(metadata, '$.taskId') = ?", userID, "saved", tx.Model(&TaskAsset{}).Select("asset_id").Where("task_id = ?", id), id).Order("created_at, id").Find(&saved).Error; err != nil { return err }
		for _, asset := range saved { if !includes(ids, asset.ID) { ids = append(ids, asset.ID) } }
		message := "用户人工确认任务失败，已停止后续核对并释放素材占用"
		if input.Status == "cancelled" { message = "用户手动取消本地任务，已停止后续核对并释放素材占用；供应商是否取消及实际用量仍以供应商记录为准" }
		previousError := task.Error
		task.Status, task.Error = input.Status, message
		if input.Status == "succeeded" { task.Error = "" } else if previousError != "" { task.Error += "；原待核对原因："+previousError }
		note := strings.TrimSpace(input.Note); if note == "" && input.Status == "succeeded" { note = previousError }
		values := map[string]any{"status": task.Status, "error": task.Error, "asset_ids": encode(ids), "resolved_by": userID, "resolved_at": time.Now(), "resolution_note": note, "response_cleanup_pending": true, "next_run_at": nil, "cancel_error": ""}
		if task.SaveState == "saving" { values["save_state"] = "failed" }
		if input.Status == "cancelled" { values["cancel_requested"] = true }
		update := tx.Model(&GenerationTask{}).Where("id = ? AND updated_at = ?", id, input.ExpectedUpdatedAt).Updates(values)
		if update.Error != nil { return update.Error }; if update.RowsAffected != 1 { return problem(409, "task_changed", "任务已更新，请重新读取后核对") }
		if err := tx.Transaction(func(inner *gorm.DB) error { return a.applyTaskResultTx(inner, task, ids, task.Text) }); err != nil {
			var p *Problem; if !errors.As(err, &p) { return err }
			if err := tx.Model(&GenerationTask{}).Where("id = ?", id).Update("apply_error", p.Message).Error; err != nil { return err }
		}
		if err := tx.Model(&TaskAsset{}).Where("task_id = ?", id).Update("released", true).Error; err != nil { return err }
		if err := tx.Model(&FileOperation{}).Where("kind = ? AND asset_id IN (?)", "delete", tx.Model(&TaskAsset{}).Select("asset_id").Where("task_id = ?", id)).Update("next_run_at", nil).Error; err != nil { return err }
		return tx.First(&task, "id = ?", id).Error
	})
	if err == nil { a.notify(userID); a.signalWork() }
	return task, err
}

func (a *App) deleteTask(c *gin.Context) {
	var input taskActionInput; if !bind(c, &input) { return }
	err := a.DeleteTask(currentUser(c).ID, c.Param("id"), input)
	if err != nil { respondError(c, err); return }; c.JSON(200, gin.H{"removed": true})
}

// Remove the list entry, retaining the stable task for canvas versions, waiting
// assistants and usage references. Deleting a task never deletes its assets.
func (a *App) DeleteTask(userID, id string, input taskActionInput) error {
	if !input.Confirmed { return problem(400, "confirmation_required", "请明确确认删除任务记录") }
	a.workMu.Lock()
	defer a.workMu.Unlock()
	err := a.db.Transaction(func(tx *gorm.DB) error {
		var task GenerationTask
		if err := tx.First(&task, "id = ? AND user_id = ?", id, userID).Error; err != nil { return err }
		if task.Removed { return nil }
		if !task.UpdatedAt.Equal(input.ExpectedUpdatedAt) { return problem(409, "task_changed", "任务已更新，请重新读取后删除") }
		if !terminalTask(task.Status) { return problem(409, "task_active", "请先取消任务或确认结果，结束后再删除记录") }
		if a.active["task:"+id] != nil { return problem(409, "task_busy", "任务仍在保存当前处理结果，请刷新后再删除") }
		var leases int64
		if err := tx.Model(&TaskAsset{}).Where("task_id = ? AND released = ?", id, false).Count(&leases).Error; err != nil { return err }
		if leases > 0 { return problem(409, "task_unresolved", "任务仍占用素材，请先手动确认结果并释放占用") }
		return tx.Model(&task).Update("removed", true).Error
	})
	if err == nil { a.notifyTopic(userID, "tasks") }
	return err
}
