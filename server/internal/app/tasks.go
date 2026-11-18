package app

import (
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type assetInput struct { AssetID string `json:"assetId"`; Role string `json:"role"`; VoiceID string `json:"voiceId,omitempty"` }

type generationInput struct {
	ChannelID string `json:"channelId"`
	ModelID string `json:"modelId"`
	Capability string `json:"capability"`
	ProjectID string `json:"projectId"`
	WorkbenchRecordID string `json:"workbenchRecordId,omitempty"`
	NodeID string `json:"nodeId"`
	ProjectVersion uint64 `json:"projectVersion"`
	ResultSlotID string `json:"resultSlotId,omitempty"`
	BatchID string `json:"batchId,omitempty"`
	Prompt string `json:"prompt"`
	Messages JSON `json:"messages"`
	Parameters JSON `json:"parameters"`
	References []assetInput `json:"references"`
}

func (a *App) createTask(c *gin.Context) {
	var input generationInput
	if !bind(c, &input) { return }
	task, err := a.CreateTask(currentUser(c).ID, input)
	if err != nil { respondError(c, err); return }
	c.JSON(202, task)
}

func (a *App) CreateTask(userID string, input generationInput) (GenerationTask, error) {
	if input.BatchID == "" { input.BatchID = identifier() }
	policy, err := a.requireExecution()
	if err != nil { return GenerationTask{}, err }
	snapshot, err := a.generationSnapshot(userID, &input)
	if err != nil { return GenerationTask{}, err }
	var selected executionSnapshot
	if err := json.Unmarshal(snapshot, &selected); err != nil { return GenerationTask{}, err }
	selected.Policy = policy
	
	if err := a.validateReferenceMedia(selected, input, userID); err != nil { return GenerationTask{}, err }
	if err := a.validateScriptInput(userID, selected, input); err != nil { return GenerationTask{}, err }
	task := GenerationTask{ID: identifier(), UserID: userID, ProjectID: input.ProjectID, WorkbenchRecordID: input.WorkbenchRecordID, NodeID: input.NodeID, ProjectVersion: input.ProjectVersion, ChannelID: input.ChannelID, ModelID: input.ModelID, Capability: input.Capability, Snapshot: encode(selected), Input: encode(input), Status: "queued", AssetIDs: JSON(`[]`), UsageState: "unknown"}
	err = a.db.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := tx.First(&user, "id = ? AND disabled = ?", userID, false).Error; err != nil { return err }
		if input.WorkbenchRecordID != "" {
			if input.ProjectID != "" || !includes([]string{"image", "video"}, input.Capability) { return problem(400, "invalid_workbench", "工作台任务仅支持独立图片或视频生成") }
			var removed int64
			if err := tx.Model(&WorkbenchRecord{}).Where("user_id = ? AND id = ? AND removed = ?", userID, input.WorkbenchRecordID, true).Count(&removed).Error; err != nil { return err }
			if removed > 0 { return problem(409, "record_removed", "生成记录已删除，请新建后生成") }
		}
		if input.ProjectID != "" {
			var project Project; if err := tx.First(&project, "id = ? AND user_id = ?", input.ProjectID, userID).Error; err != nil { return err }
			if !onlyTaskUpdates(tx, project.ID, input.BatchID, input.ProjectVersion, project.Version) { return problem(409, "version_conflict", "项目已更新，请重新读取后提交") }
			if input.NodeID != "" {
				var document struct { Nodes []json.RawMessage `json:"nodes"` }; if err := json.Unmarshal(project.Document, &document); err != nil { return err }
				for _, raw := range document.Nodes { var node struct { ID string `json:"id"` }; if err := json.Unmarshal(raw, &node); err != nil { return err }; if node.ID == input.NodeID { task.TargetNode = raw; break } }
				if len(task.TargetNode) == 0 { return problem(409, "node_not_saved", "目标节点尚未保存，请先完成项目保存") }
			}
		}
		for _, reference := range input.References {
			var asset Asset
			if err := tx.First(&asset, "id = ? AND user_id = ? AND save_state = ? AND delete_state = ?", reference.AssetID, userID, "saved", "").Error; err != nil { return problem(400, "invalid_asset", "素材已删除或尚未可靠保存") }
			if err := tx.FirstOrCreate(&TaskAsset{TaskID: task.ID, AssetID: asset.ID}).Error; err != nil { return err }
		}
		return tx.Create(&task).Error
	})
	if err != nil { return task, err }
	a.notify(userID); a.signalWork()
	return task, nil
}

func (a *App) generationSnapshot(userID string, input *generationInput) (JSON, error) {
	var channel Channel
	var model ChannelModel
	var script *ScriptVersion
	err := a.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.First(&channel, "id = ? AND enabled = ?", input.ChannelID, true).Error; err != nil { return err }
		if err := tx.First(&model, "id = ? AND channel_id = ? AND enabled = ?", input.ModelID, channel.ID, true).Error; err != nil { return err }
		if channel.Secret == "" || model.Capability != input.Capability { return problem(400, "invalid_model", "渠道凭据或模型能力不匹配") }
		if input.ProjectID != "" {
			var project Project
			if err := tx.First(&project, "id = ? AND user_id = ?", input.ProjectID, userID).Error; err != nil { return err }
			if !onlyTaskUpdates(tx, project.ID, input.BatchID, input.ProjectVersion, project.Version) { return problem(409, "version_conflict", "目标项目已更新，请重新读取后提交") }
			if input.NodeID != "" {
				var document struct { Nodes []struct { ID string `json:"id"` } `json:"nodes"` }
				if json.Unmarshal(project.Document, &document) != nil { return problem(409, "invalid_document", "目标项目内容无法读取") }
				found := false
				for _, node := range document.Nodes { if node.ID == input.NodeID { found = true; break } }
				if !found { return problem(409, "node_not_saved", "目标节点尚未保存，请先完成项目保存") }
				if input.ResultSlotID != "" {
					var value map[string]any; _ = json.Unmarshal(project.Document, &value)
					key := "images"; if input.Capability == "text" { key = "texts" } else if input.Capability != "image" { return problem(400, "invalid_slot", "仅图片和文本支持结果位置") }
					found := false
					for _, raw := range array(value["nodes"]) { node := object(raw); if node["id"] == input.NodeID { for _, slot := range array(object(node["metadata"])[key]) { if object(slot)["id"] == input.ResultSlotID { found = true } } } }
					if !found { return problem(409, "result_slot_missing", "结果位置尚未保存，请先完成项目保存") }
				}
			}
		}
		if input.NodeID != "" && input.ProjectID == "" { return problem(400, "project_required", "节点任务需要明确目标项目") }
		if strings.TrimSpace(input.Prompt) == "" && len(input.Messages) == 0 { return problem(400, "prompt_required", "请输入提示词或消息") }
		var parameters map[string]any
		if json.Unmarshal(input.Parameters, &parameters) != nil || parameters == nil { return problem(400, "invalid_parameters", "参数需要对象") }
		if len(input.Messages) > 0 {
			if err := validateGenerationMessages(*input); err != nil { return err }
		}
		if model.AdapterVersionID == "" { return problem(400, "interface_unpublished", "接口脚本尚未发布") }
		script = &ScriptVersion{}
		if err := tx.First(script, "id = ? AND adapter_id = ?", model.AdapterVersionID, model.AdapterID).Error; err != nil { return err }
		if err := hydrateModel(tx, &model); err != nil { return err }
		definitions := model.Parameters
		var controls []parameterControl
		if json.Unmarshal(definitions, &controls) != nil { return problem(409, "invalid_parameters", "模型参数定义无法读取，请联系管理员") }
		resolved, err := resolveParameters(model.Parameters, parameters); if err != nil { return err }; parameters = resolved
		for _, control := range controls {
			value := parameters[control.Key]
			if control.Type == "asset" && value != nil && value != "" {
				found := false
				for _, reference := range input.References { if reference.AssetID == value && reference.Role == control.Role { found = true; break } }
				if !found { input.References = append(input.References, assetInput{AssetID: text(value), Role: control.Role}) }
			}
		}
		if err := snapshotAssetInputs(tx, userID, channel.ID, input.References); err != nil { return err }
		encoded, err := json.Marshal(parameters)
		if err != nil { return err }
		input.Parameters = encoded
		return nil
	})
	if err != nil { return nil, err }
	return json.Marshal(map[string]any{"channelId": channel.ID, "channelVersion": channel.Version, "baseUrl": channel.BaseURL, "credential": channel.Secret, "model": model, "script": script})
}

func snapshotAssetInputs(tx *gorm.DB, userID, channelID string, references []assetInput) error {
	for index, reference := range references {
		var asset Asset
		if err := tx.First(&asset, "id = ? AND user_id = ? AND save_state = ? AND delete_state = ?", reference.AssetID, userID, "saved", "").Error; err != nil { return problem(400, "invalid_asset", "参考素材不存在、已删除或尚未保存") }
		if asset.Kind != reference.Role { return problem(400, "invalid_asset_role", "参考素材类型不匹配") }
		references[index].VoiceID = ""
		if asset.Kind == "audio" { var voice AssetVoice; err := tx.First(&voice, "asset_id = ? AND channel_id = ? AND user_id = ?", asset.ID, channelID, userID).Error; if err == nil { references[index].VoiceID = voice.VoiceID } else if !errors.Is(err, gorm.ErrRecordNotFound) { return err } }
	}
	return nil
}

func validateGenerationMessages(input generationInput) error {
	invalid := problem(400, "invalid_messages", "消息需包含有效角色、文本或已保存的图片资产")
	var messages []map[string]any
	if json.Unmarshal(input.Messages, &messages) != nil || len(messages) == 0 { return invalid }
	for _, message := range messages {
		role, _ := message["role"].(string)
		if role != "system" && role != "user" && role != "assistant" { return invalid }
		switch content := message["content"].(type) {
		case string:
			if strings.TrimSpace(content) == "" { return invalid }
		case []any:
			if len(content) == 0 { return invalid }
			for _, item := range content {
				part, ok := item.(map[string]any)
				if !ok { return invalid }
				if part["type"] == "text" { text, ok := part["text"].(string); if !ok || strings.TrimSpace(text) == "" { return invalid }; continue }
				if part["type"] != "image_asset" { return invalid }
				id, _ := part["assetId"].(string)
				found := false
				for _, reference := range input.References { if reference.AssetID == id && reference.Role == "image" { found = true; break } }
				if !found { return invalid }
			}
		default: return invalid
		}
	}
	return nil
}

func (a *App) listTasks(c *gin.Context) {
	tasks := []GenerationTask{}
	if err := a.db.Where("user_id = ?", currentUser(c).ID).Order("created_at DESC").Find(&tasks).Error; err != nil { respondError(c, err); return }
	c.JSON(200, tasks)
}

func (a *App) getTask(c *gin.Context) {
	var task GenerationTask
	if err := a.db.First(&task, "id = ? AND user_id = ?", c.Param("id"), currentUser(c).ID).Error; err != nil { respondError(c, err); return }
	c.JSON(200, task)
}

func terminalTask(status string) bool { return includes([]string{"succeeded", "failed", "cancelled", "interrupted"}, status) }

func (a *App) cancelTask(c *gin.Context) {
	task, err := a.CancelTask(currentUser(c).ID, c.Param("id"))
	if err != nil { respondError(c, err); return }
	c.JSON(200, task)
}

func (a *App) CancelTask(userID, id string) (GenerationTask, error) {
	var task GenerationTask
	err := a.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.First(&task, "id = ? AND user_id = ?", id, userID).Error; err != nil { return err }
		if terminalTask(task.Status) { return nil }
		if task.Status != "queued" && task.Status != "waiting_assets" {
			message := "已记录取消意愿；供应商未确认取消，仍会核对实际结果与用量，并保存最终成品"
			return tx.Model(&task).Updates(map[string]any{"cancel_requested": true, "cancel_error": message}).Error
		}
		task.Status, task.Error = "cancelled", "任务已在提交供应商前取消"
		if err := tx.Transaction(func(inner *gorm.DB) error { return a.applyTaskResultTx(inner, task, nil, task.Text) }); err != nil {
			var p *Problem; if !errors.As(err, &p) { return err }
			if err := tx.Model(&GenerationTask{}).Where("id = ?", task.ID).Update("apply_error", p.Message).Error; err != nil { return err }
		}
		if err := tx.Model(&task).Updates(map[string]any{"status": "cancelled", "cancel_requested": true, "error": task.Error, "response_cleanup_pending": true}).Error; err != nil { return err }
		if err := tx.Model(&TaskAsset{}).Where("task_id = ?", task.ID).Update("released", true).Error; err != nil { return err }
		return tx.First(&task, "id = ?", task.ID).Error
	})
	if err == nil { a.notify(userID); a.signalWork() }
	if err == nil { err = a.db.First(&task, "id = ?", task.ID).Error }
	return task, err
}

func (a *App) resumeTask(c *gin.Context) {
	task, err := a.ResumeTask(currentUser(c).ID, c.Param("id"))
	if err != nil { respondError(c, err); return }; c.JSON(202, task)
}

func (a *App) ResumeTask(userID, id string) (GenerationTask, error) {
	var task GenerationTask
	if err := a.db.First(&task, "id = ? AND user_id = ?", id, userID).Error; err != nil { return task, err }
	if task.Status != "confirmation_required" { return task, problem(409, "resume_unavailable", "仅待确认任务可继续核对") }
	if err := a.recoverTaskResponse(&task); err != nil { return task, err }
	status := "running"
	var result providerResult
	if json.Unmarshal(task.Result, &result) == nil && (includes([]string{"completed", "incomplete", "failed", "cancelled"}, result.Status) || result.URL != "" || result.ResponseFile != "") { status = "saving" } else if task.UpstreamID == "" && task.RawResponseFile == "" { return task, problem(409, "no_recovery_basis", "没有可查询的上游编号或已保存结果，不能重新提交；请核对供应商账单") }
	update := a.db.Model(&GenerationTask{}).Where("id = ? AND status = ?", task.ID, "confirmation_required").Updates(map[string]any{"status": status, "query_failures": 0, "transfer_attempts": 0, "query_started_at": time.Now(), "next_run_at": time.Now(), "error": ""})
	if update.Error != nil { return task, update.Error }; if update.RowsAffected != 1 { return task, problem(409, "task_changed", "任务状态已改变，请重新读取") }
	if err := a.db.First(&task, "id = ?", task.ID).Error; err != nil { return task, err }
	a.notify(task.UserID); a.signalWork(); return task, nil
}

func (a *App) taskEvents(c *gin.Context) {
	var task GenerationTask
	if err := a.db.First(&task, "id = ? AND user_id = ?", c.Param("id"), currentUser(c).ID).Error; err != nil { respondError(c, err); return }
	updates, stop := a.subscribe(currentUser(c).ID)
	defer stop()
	c.Header("Content-Type", "text/event-stream")
	c.Header("X-Accel-Buffering", "no")
	for {
		if !a.sessionValid(c) { return }
		if err := a.db.First(&task, "id = ? AND user_id = ?", task.ID, currentUser(c).ID).Error; err != nil { return }
		if writeEvent(c, "snapshot", task) != nil || terminalTask(task.Status) || task.Status == "confirmation_required" { return }
		select { case <-c.Request.Context().Done(): return; case <-updates: }
	}
}
