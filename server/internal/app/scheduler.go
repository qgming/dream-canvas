package app

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	"gorm.io/gorm"
)

func (a *App) signalWork() { select { case a.wake <- struct{}{}: default: } }

func (a *App) recoverTaskResponse(task *GenerationTask) error {
	if task.RawResponseFile != "" { return nil }; if _, err := a.assetPath(task.ID); err != nil { return err }
	name := task.ID+".script.json"; info, err := os.Stat(filepath.Join(a.root, "results", name)); if errors.Is(err, os.ErrNotExist) { return nil }; if err != nil { return err }; if !info.Mode().IsRegular() { return errors.New("invalid task response file") }
	if err := a.db.Model(task).Update("raw_response_file", name).Error; err != nil { return err }; task.RawResponseFile = name; return nil
}

func (a *App) recoverExecution() error {
	var pending []GenerationTask
	if err := a.db.Where("status IN ? AND raw_response_file = ?", []string{"submitting", "running", "confirmation_required"}, "").Find(&pending).Error; err != nil { return err }
	for _, task := range pending { if err := a.recoverTaskResponse(&task); err != nil { return err } }
	if err := a.db.Model(&ClientCommand{}).Where("status = ?", "pending").Updates(map[string]any{"status": "interrupted", "error": "服务重启，页面操作未确认；请重新读取明确在线的客户端"}).Error; err != nil { return err }
	// A process restart never turns an uncertain paid submission into another POST.
	if err := a.db.Model(&GenerationTask{}).Where("status = ? OR (status = ? AND upstream_id = ?)", "submitting", "running", "").Updates(map[string]any{"status": "confirmation_required", "error": "服务在供应商响应确认前停止，结果与用量待确认；未重新提交"}).Error; err != nil { return err }
	if err := a.db.Model(&AssistantTurn{}).Where("status NOT IN ?", append([]string{"queued", "waiting_tasks", assistantWaitingUser}, assistantTerminalStates...)).Updates(map[string]any{"status": "interrupted", "error": "轮次执行状态无法恢复；已保存消息与用量保留，未重新请求模型"}).Error; err != nil { return err }
	if err := a.db.Model(&TaskAsset{}).Where("task_id IN (?)", a.db.Model(&AssistantTurn{}).Select("'turn:' || id").Where("status IN ?", assistantTerminalStates)).Update("released", true).Error; err != nil { return err }
	if err := a.db.Model(&Asset{}).Where("sync_state = ?", "syncing").Update("sync_state", "pending").Error; err != nil { return err }
	return nil
}

func (a *App) schedule() {
	defer a.workers.Done()
	for {
		policy, err := a.executionPolicy()
		if err == nil {
			a.dispatch(policy)
			// Revisit durable work after transient database errors using the configured poll interval.
			fallback := time.Now().Add(seconds(policy.PollSeconds))
			next := &fallback
			for _, table := range []any{&GenerationTask{}, &FileOperation{}} {
				var row struct { NextRunAt *time.Time }
				if a.db.Model(table).Select("next_run_at").Where("next_run_at > ?", time.Now()).Order("next_run_at").Limit(1).Scan(&row).Error == nil && row.NextRunAt != nil && (next == nil || row.NextRunAt.Before(*next)) { next = row.NextRunAt }
			}
			if next != nil { timer := time.NewTimer(time.Until(*next)); select { case <-a.ctx.Done(): timer.Stop(); return; case <-a.wake: timer.Stop(); case <-timer.C: }; continue }
		} else {
			// Local cleanup needs no supplier timeout or retry policy.
			var operations []FileOperation
			if a.db.Where("kind = ? AND next_run_at IS NULL AND asset_id IN (?) AND NOT EXISTS (SELECT 1 FROM task_assets WHERE task_assets.asset_id = file_operations.asset_id AND released = ?)", "delete", a.db.Model(&Asset{}).Select("id").Where("storage_id = ?", ""), false).Find(&operations).Error == nil { for _, operation := range operations { a.launch("file:"+operation.AssetID, func(ctx context.Context) { if a.cleanAsset(operation.AssetID) == nil { a.db.Delete(&FileOperation{}, "id = ?", operation.ID) } }) } }
		}
		select { case <-a.ctx.Done(): return; case <-a.wake: }
	}
}

func (a *App) launch(key string, run func(context.Context)) bool {
	a.workMu.Lock()
	if a.active[key] != nil { a.workMu.Unlock(); return false }
	ctx, cancel := context.WithCancel(a.ctx)
	a.active[key] = cancel
	a.workers.Add(1)
	a.workMu.Unlock()
	go func() {
		defer a.workers.Done()
		before := a.workRevision(key)
		defer func() {
			cancel()
			a.workMu.Lock()
			delete(a.active, key)
			a.workMu.Unlock()
			if after := a.workRevision(key); before != "" && after != "" && before != after { a.signalWork() }
		}()
		defer func() {
			if recovered := recover(); recovered != nil {
				a.logFailure(ctx, "worker.panic", panicError(recovered), slog.String("work_key", key))
			}
		}()
		run(ctx)
	}()
	return true
}

// A failed database operation does not immediately relaunch the same unchanged work.
func (a *App) workRevision(key string) string {
	parts := strings.SplitN(key, ":", 2); if len(parts) != 2 { return "" }
	var model any
	switch parts[0] { case "task", "results": model = &GenerationTask{}; case "turn": model = &AssistantTurn{}; case "file": model = &Asset{}; default: return "" }
	var row struct { UpdatedAt time.Time }
	err := a.db.Model(model).Select("updated_at").Where("id = ?", parts[1]).Take(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) { return "removed" }; if err != nil { return "" }; return row.UpdatedAt.String()
}

func (a *App) dispatch(policy executionPolicy) {
	a.repairAssistantUsage()
	var cleanup []GenerationTask
	if a.db.Where("response_cleanup_pending = ? AND (next_run_at IS NULL OR next_run_at <= ?)", true, time.Now()).Find(&cleanup).Error == nil { for _, task := range cleanup { a.launch("results:"+task.ID, func(ctx context.Context) { a.cleanupTaskResponses(task) }) } }
	var tasks []GenerationTask
	if a.db.Where("status IN ?", []string{"queued", "waiting_assets", "submitting", "running", "saving"}).Order("created_at").Find(&tasks).Error != nil { return }
	counts, total := map[string]int{}, 0
	for _, task := range tasks { if task.Status == "running" || task.Status == "submitting" { total++; counts[task.UserID]++ } }
	a.workMu.Lock()
	for _, task := range tasks { if a.active["task:"+task.ID] != nil && task.Status != "running" && task.Status != "submitting" && task.Status != "saving" { total++; counts[task.UserID]++ } }
	a.workMu.Unlock()
	for _, task := range tasks {
		if task.Status == "submitting" { continue }
		if task.NextRunAt != nil && task.NextRunAt.After(time.Now()) { continue }
		if task.Status == "queued" || task.Status == "waiting_assets" {
			if total >= policy.GenerationSlots || counts[task.UserID] >= policy.UserSlots { continue }
		}
		if a.launch("task:"+task.ID, func(ctx context.Context) { a.executeTask(ctx, task.ID) }) && (task.Status == "queued" || task.Status == "waiting_assets") { total++; counts[task.UserID]++ }
	}
	var turns []AssistantTurn
	if a.db.Where("status IN ?", []string{"queued", "waiting_tasks"}).Order("created_at").Find(&turns).Error == nil {
		running := 0
		a.workMu.Lock(); for key := range a.active { if strings.HasPrefix(key, "turn:") { running++ } }; a.workMu.Unlock()
		for _, turn := range turns { if running >= policy.AssistantSlots { break }; if turn.Status == "waiting_tasks" && !a.assistantTasksReady(turn) { continue }; if a.launch("turn:"+turn.ID, func(ctx context.Context) { a.executeAssistant(ctx, turn.ID) }) { running++ } }
	}
	a.dispatchFiles()
}

func (a *App) executeTask(ctx context.Context, id string) {
	var task GenerationTask
	if a.db.First(&task, "id = ?", id).Error != nil { return }
	if !includes([]string{"queued", "waiting_assets", "submitting", "running", "saving"}, task.Status) { return }
	ctx = withLogContext(ctx, slog.String("task_id", task.ID), slog.String("user_id", task.UserID), slog.String("channel_id", task.ChannelID), slog.String("model_id", task.ModelID))
	var snapshot executionSnapshot
	var input generationInput
	if json.Unmarshal(task.Snapshot, &snapshot) != nil || json.Unmarshal(task.Input, &input) != nil { a.taskProblem(task, "interrupted", "任务快照无法读取，未提交或重提供应商", false); return }
	if task.Status == "saving" { a.saveTaskResults(ctx, task, snapshot); return }
	query := task.Status == "running" && (task.UpstreamID != "" || task.RawResponseFile != "")
	if !query && task.Status != "queued" && task.Status != "waiting_assets" { return }
	if query && taskWaitExpired(task, snapshot.Policy) { a.taskProblem(task, "confirmation_required", "等待时长已达配置边界，已暂停查询；可继续核对，不会重新生成", false); return }
	if !query {
		var user User
		if a.db.First(&user, "id = ? AND disabled = ?", task.UserID, false).Error != nil { a.taskProblem(task, "cancelled", "账号已停用，任务未提交", true); return }
		ready, err := a.prepareTaskAssets(task, snapshot, input)
		if err != nil { a.taskProblem(task, "failed", "参考素材无法准备，请检查保存和云同步状态", true); return }
		if !ready { return }
		startedAt := time.Now()
		usage := a.usageEntry("task:"+task.ID, task, "", startedAt, nil, snapshot, "unknown")
		err = a.db.Transaction(func(tx *gorm.DB) error {
			result := tx.Model(&GenerationTask{}).Where("id = ? AND status IN ? AND cancel_requested = ?", task.ID, []string{"queued", "waiting_assets"}, false).Updates(map[string]any{"status": "submitting", "started_at": startedAt, "next_run_at": nil, "error": ""})
			if result.Error != nil { return result.Error }
			if result.RowsAffected != 1 { return problem(409, "task_changed", "任务状态已变化，未提交供应商") }
			return upsertUsage(tx, usage)
		})
		if err != nil { return }
		task.StartedAt = &startedAt
		a.logEvent(ctx, slog.LevelInfo, "task.started", slog.String("capability", task.Capability))
		a.notify(task.UserID)
	}
	limit := snapshot.Policy.ImageSeconds
	if query { limit = snapshot.Policy.QuerySeconds } else if input.Capability == "text" { limit = snapshot.Policy.TextSeconds } else if input.Capability == "audio" { limit = snapshot.Policy.AudioSeconds } else if input.Capability == "video" { limit = snapshot.Policy.QuerySeconds }
	callCtx, cancel := context.WithTimeout(ctx, seconds(limit))
	defer cancel()
	var result providerResult
	var err error
	result, err = a.callModelScript(callCtx, task, snapshot, input, query)
	if err != nil {
		a.logFailure(callCtx, "task.call_failed", err, slog.Bool("query", query))
		if !query && beforeModelSubmission(err) {
			if cleanupErr := a.discardUnsubmittedUsage("task:"+task.ID, task.UserID); cleanupErr != nil { a.taskProblem(task, "confirmation_required", "供应商请求尚未开始，但待确认用量记录无法清理", false); return }
			var current GenerationTask
			_ = a.db.First(&current, "id = ?", task.ID)
			status, message := "failed", providerError(err)
			if current.CancelRequested {
				status, message = "cancelled", "任务已在提交供应商前取消"
			} else if ctx.Err() != nil {
				status, message = "interrupted", "任务在提交供应商前中断；结果与用量无需待确认"
			}
			a.taskProblem(task, status, message, true)
			return
		}
		var parse *scriptParseError; if errors.As(err, &parse) { a.taskProblem(task, "confirmation_required", parse.Error(), false); return }
		if query { a.queryFailed(task, snapshot, err); return }
		result.Status, result.Error = "confirmation_required", providerError(err)
		if definitiveRejection(err) { result.Status = "failed" }
	}
	if result.UpstreamID != "" { task.UpstreamID = result.UpstreamID }
	if !includes([]string{"completed", "incomplete", "failed", "cancelled", "confirmation_required"}, result.Status) {
		if task.UpstreamID == "" { a.taskProblem(task, "confirmation_required", "接口插件未解析出可靠查询编号，请管理员核对响应映射；未重新提交", false); return }
		next := time.Now().Add(seconds(snapshot.Policy.PollSeconds))
		if err := a.db.Model(&GenerationTask{}).Where("id = ?", task.ID).Updates(map[string]any{"status": "running", "provider_status": result.Status, "progress": result.Progress, "upstream_id": task.UpstreamID, "query_failures": 0, "raw_response_file": "", "next_run_at": next, "error": ""}).Error; err != nil { return }
		fields := []slog.Attr{slog.String("provider_status", result.Status), slog.Bool("has_progress", result.Progress != nil)}; if result.Progress != nil { fields = append(fields, slog.Float64("progress", *result.Progress)) }
		a.logEvent(ctx, slog.LevelDebug, "task.provider_updated", fields...)
		a.notify(task.UserID); a.signalWork(); return
	}
	if err := a.db.Model(&GenerationTask{}).Where("id = ?", task.ID).Updates(map[string]any{"status": "saving", "provider_status": result.Status, "progress": result.Progress, "upstream_id": task.UpstreamID, "result": encode(result), "text": result.Text, "save_state": "saving", "next_run_at": nil, "error": result.Error}).Error; err != nil { return }
	a.notifyTopic(task.UserID, "tasks")
	if a.db.First(&task, "id = ?", task.ID).Error == nil { a.saveTaskResults(ctx, task, snapshot) }
}

func taskWaitExpired(task GenerationTask, policy executionPolicy) bool {
	started := task.QueryStartedAt; if started == nil { started = task.StartedAt }
	return started != nil && time.Since(*started) >= seconds(policy.MaxWaitSeconds)
}

func (a *App) queryFailed(task GenerationTask, snapshot executionSnapshot, err error) {
	a.logFailure(a.ctx, "task.query_failed", err, slog.String("task_id", task.ID), slog.Int("attempt", task.QueryFailures+1))
	failures := task.QueryFailures + 1
	if failures >= snapshot.Policy.QueryFailures || taskWaitExpired(task, snapshot.Policy) { a.taskProblem(task, "confirmation_required", "已达到查询重试或等待上限。最近一次查询："+providerError(err), false); return }
	next := time.Now().Add(seconds(snapshot.Policy.PollSeconds))
	a.db.Model(&task).Updates(map[string]any{"query_failures": failures, "next_run_at": next, "error": providerError(err)})
	a.notify(task.UserID); a.signalWork()
}

func (a *App) taskProblem(task GenerationTask, status, message string, release bool) {
	err := a.db.Transaction(func(tx *gorm.DB) error {
		if release {
			task.Status, task.Error = status, message
			if err := tx.Transaction(func(inner *gorm.DB) error { return a.applyTaskResultTx(inner, task, nil, task.Text) }); err != nil {
				var p *Problem; if !errors.As(err, &p) { return err }
				if err := tx.Model(&GenerationTask{}).Where("id = ?", task.ID).Update("apply_error", p.Message).Error; err != nil { return err }
			}
		}
		if err := tx.Model(&GenerationTask{}).Where("id = ?", task.ID).Updates(map[string]any{"status": status, "error": message, "next_run_at": nil}).Error; err != nil { return err }
		if release { if err := tx.Model(&GenerationTask{}).Where("id = ?", task.ID).Update("response_cleanup_pending", true).Error; err != nil { return err }; return tx.Model(&TaskAsset{}).Where("task_id = ?", task.ID).Update("released", true).Error }
		return nil
	})
	if err == nil { level := slog.LevelInfo; if status == "failed" || status == "interrupted" || status == "confirmation_required" { level = slog.LevelWarn }; a.logEvent(a.ctx, level, "task.status_changed", slog.String("task_id", task.ID), slog.String("status", status)); a.notify(task.UserID); a.signalWork() } else { a.logFailure(a.ctx, "task.status_save_failed", err, slog.String("task_id", task.ID)) }
}

func (a *App) taskSaveFailed(task GenerationTask, snapshot executionSnapshot, err error) {
	a.logFailure(a.ctx, "task.result_save_failed", err, slog.String("task_id", task.ID), slog.Int("attempt", task.TransferAttempts+1))
	attempt := task.TransferAttempts
	values := map[string]any{"save_state": "failed", "error": "供应商已返回结果，但原件保存失败；结果尚未可靠保留，请检查磁盘或网络后继续保存", "transfer_attempts": attempt + 1}
	if attempt < len(snapshot.Policy.DownloadRetrySeconds) { values["next_run_at"] = time.Now().Add(seconds(snapshot.Policy.DownloadRetrySeconds[attempt])) } else { values["status"], values["next_run_at"] = "confirmation_required", nil }
	if a.db.Model(&task).Updates(values).Error == nil { a.notify(task.UserID); a.signalWork() }
}
