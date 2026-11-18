package app

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

type taskQueryRecoveryInput struct {
	UpstreamID string `json:"upstreamId"`
	ExpectedUpdatedAt time.Time `json:"expectedUpdatedAt"`
	Confirmed bool `json:"confirmed"`
}

func (a *App) recoverTaskQuery(c *gin.Context) {
	var input taskQueryRecoveryInput; if !bind(c, &input) { return }
	task, err := a.RecoverTaskQuery(c.Request.Context(), currentUser(c), c.Param("id"), input)
	if err != nil { respondError(c, err); return }; c.JSON(202, task)
}

// Administrators explicitly identify an ID in the saved submit response. This
// neither changes the immutable script snapshot nor creates another submission.
func (a *App) RecoverTaskQuery(ctx context.Context, user User, id string, input taskQueryRecoveryInput) (GenerationTask, error) {
	var task GenerationTask
	if user.Role != "admin" { return task, problem(403, "forbidden", "需要管理员权限") }
	if !input.Confirmed || strings.TrimSpace(input.UpstreamID) == "" || input.UpstreamID != strings.TrimSpace(input.UpstreamID) { return task, problem(400, "confirmation_required", "请核对原提交响应中的任务编号并明确确认只继续查询") }
	if err := a.db.First(&task, "id = ? AND user_id = ?", id, user.ID).Error; err != nil { return task, err }
	if !task.UpdatedAt.Equal(input.ExpectedUpdatedAt) { return task, problem(409, "task_changed", "任务已更新，请重新读取后核对") }
	if task.Status != "confirmation_required" || task.UpstreamID != "" { return task, problem(409, "recovery_unavailable", "仅缺少查询编号的待核对任务可补充依据") }
	var snapshot executionSnapshot; var scripts map[string]string
	if json.Unmarshal(task.Snapshot, &snapshot) != nil || snapshot.Script == nil || json.Unmarshal(snapshot.Script.Scripts, &scripts) != nil || scripts["query"] == "" { return task, problem(409, "query_unavailable", "原任务脚本没有可用查询阶段，不能继续查询") }
	if task.RawResponseFile != task.ID+".script.json" || snapshot.Policy.JSONBytes <= 0 { return task, problem(409, "response_unavailable", "没有保留可核对的原提交响应，不能补充查询编号") }
	file, err := os.Open(filepath.Join(a.root, "results", task.RawResponseFile)); if err != nil { return task, problem(409, "response_unavailable", "原提交响应无法读取，请保留任务记录") }; defer file.Close()
	info, err := file.Stat(); if err != nil { return task, err }; if info.Size() > snapshot.Policy.JSONBytes { return task, problem(409, "response_boundary", "原响应超过已配置 JSON 边界，不能自动核对") }
	var saved struct { Phase string `json:"phase"`; Response any `json:"response"` }
	if json.NewDecoder(io.LimitReader(file, snapshot.Policy.JSONBytes)).Decode(&saved) != nil || saved.Phase != "submit" || !responseContainsID(saved.Response, input.UpstreamID) { return task, problem(400, "unverified_upstream_id", "编号必须与保留的原提交响应中的字符串字段完全一致；没有重新提交") }
	now := time.Now()
	update := a.db.Model(&GenerationTask{}).Where("id = ? AND status = ? AND upstream_id = ? AND updated_at = ?", task.ID, "confirmation_required", "", task.UpdatedAt).Updates(map[string]any{"upstream_id": input.UpstreamID, "status": "running", "query_failures": 0, "query_started_at": now, "query_recovered_at": now, "query_recovered_by": user.ID, "next_run_at": now, "error": ""})
	if update.Error != nil { return task, update.Error }; if update.RowsAffected != 1 { return task, problem(409, "task_changed", "任务状态已改变，请重新读取") }
	if err := a.db.First(&task, "id = ?", task.ID).Error; err != nil { return task, err }
	a.logEvent(ctx, slog.LevelInfo, "task.query_recovered", slog.String("task_id", task.ID), slog.String("user_id", user.ID))
	a.notify(task.UserID); a.signalWork(); return task, nil
}

func responseContainsID(value any, id string) bool {
	switch value := value.(type) {
	case string: return value == id
	case map[string]any: for _, item := range value { if responseContainsID(item, id) { return true } }
	case []any: for _, item := range value { if responseContainsID(item, id) { return true } }
	}
	return false
}
