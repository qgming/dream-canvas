package app

import (
	"encoding/json"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type generationInput struct {
	ChannelID string `json:"channelId"`
	ModelID string `json:"modelId"`
	Capability string `json:"capability"`
	ProjectID string `json:"projectId"`
	NodeID string `json:"nodeId"`
	ProjectVersion uint64 `json:"projectVersion"`
	Prompt string `json:"prompt"`
	Messages JSON `json:"messages"`
	Parameters JSON `json:"parameters"`
	References []struct { AssetID string `json:"assetId"`; Role string `json:"role"` } `json:"references"`
}

func executionUnavailable() error { return problem(503, "execution_not_configured", "服务端生成执行尚未启用：运行超时、查询与重试边界待确认，供应商适配和调度尚待完成；本次未提交上游，也未产生供应商费用") }

func (a *App) createTask(c *gin.Context) {
	var input generationInput
	if !bind(c, &input) { return }
	if _, err := a.generationSnapshot(currentUser(c).ID, &input); err != nil { respondError(c, err); return }
	// Never accept a paid task until the execution policy and adapter are available.
	respondError(c, executionUnavailable())
}

func (a *App) generationSnapshot(userID string, input *generationInput) (JSON, error) {
	var channel Channel
	var model ChannelModel
	var script *InterfaceVersion
	err := a.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.First(&channel, "id = ? AND enabled = ?", input.ChannelID, true).Error; err != nil { return err }
		if err := tx.First(&model, "id = ? AND channel_id = ? AND enabled = ?", input.ModelID, channel.ID, true).Error; err != nil { return err }
		if channel.Secret == "" || model.Capability != input.Capability { return problem(400, "invalid_model", "渠道凭据或模型能力不匹配") }
		if input.ProjectID != "" {
			var project Project
			if err := tx.First(&project, "id = ? AND user_id = ?", input.ProjectID, userID).Error; err != nil { return err }
			if project.Version != input.ProjectVersion { return problem(409, "version_conflict", "目标项目已更新，请重新读取后提交") }
			if input.NodeID != "" {
				var document struct { Nodes []struct { ID string `json:"id"` } `json:"nodes"` }
				if json.Unmarshal(project.Document, &document) != nil { return problem(409, "invalid_document", "目标项目内容无法读取") }
				found := false
				for _, node := range document.Nodes { if node.ID == input.NodeID { found = true; break } }
				if !found { return problem(409, "node_not_saved", "目标节点尚未保存，请先完成项目保存") }
			}
		}
		if input.NodeID != "" && input.ProjectID == "" { return problem(400, "project_required", "节点任务需要明确目标项目") }
		if strings.TrimSpace(input.Prompt) == "" && len(input.Messages) == 0 { return problem(400, "prompt_required", "请输入提示词或消息") }
		var parameters map[string]any
		if json.Unmarshal(input.Parameters, &parameters) != nil || parameters == nil { return problem(400, "invalid_parameters", "参数需要对象") }
		if len(input.Messages) > 0 {
			if err := validateGenerationMessages(*input); err != nil { return err }
		}
		for _, reference := range input.References {
			var asset Asset
			if err := tx.First(&asset, "id = ? AND user_id = ? AND save_state = ? AND delete_state = ?", reference.AssetID, userID, "saved", "").Error; err != nil { return problem(400, "invalid_asset", "参考素材不存在、已删除或尚未保存") }
			if asset.Kind != reference.Role { return problem(400, "invalid_asset_role", "参考素材类型不匹配") }
		}
		if model.Protocol == "custom" {
			if model.PublishedVersionID == "" { return problem(400, "interface_unpublished", "自定义接口尚未发布") }
			script = &InterfaceVersion{}
			if err := tx.First(script, "id = ? AND model_id = ?", model.PublishedVersionID, model.ID).Error; err != nil { return err }
		}
		definitions := model.Parameters
		if script != nil { definitions = script.Parameters }
		var controls []parameterControl
		if json.Unmarshal(definitions, &controls) != nil { return problem(409, "invalid_parameters", "模型参数定义无法读取，请联系管理员") }
		for _, control := range controls {
			value, exists := parameters[control.Key]
			if !exists && control.Default != nil { value, exists = control.Default, true; parameters[control.Key] = value }
			if !exists || value == nil { if control.Required { return problem(400, "parameter_required", "请填写参数「"+control.Label+"」") }; continue }
			if err := validateParameterValue(control, value); err != nil { return err }
			if text, ok := value.(string); ok && strings.TrimSpace(text) == "" { if control.Required { return problem(400, "parameter_required", "请填写参数「"+control.Label+"」") }; continue }
			if control.Type == "asset" {
				found := false
				for _, reference := range input.References { if reference.AssetID == value && reference.Role == control.Role { found = true; break } }
				if !found { return problem(400, "invalid_parameter_asset", "参数「"+control.Label+"」需要已保存且类型正确的参考素材") }
			}
		}
		encoded, err := json.Marshal(parameters)
		if err != nil { return err }
		input.Parameters = encoded
		return nil
	})
	if err != nil { return nil, err }
	return json.Marshal(map[string]any{"channelId": channel.ID, "channelVersion": channel.Version, "baseUrl": channel.BaseURL, "credential": channel.Secret, "model": model, "script": script})
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
	var task GenerationTask
	err := a.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.First(&task, "id = ? AND user_id = ?", c.Param("id"), currentUser(c).ID).Error; err != nil { return err }
		if terminalTask(task.Status) { return nil }
		if task.Status != "queued" && task.Status != "waiting_assets" { return problem(409, "cancellation_unavailable", "任务已提交或结果不确定，供应商取消与结果核对尚未接入，不能宣称取消成功") }
		if err := tx.Model(&task).Updates(map[string]any{"status": "cancelled", "cancel_requested": true}).Error; err != nil { return err }
		if err := tx.Model(&TaskAsset{}).Where("task_id = ?", task.ID).Update("released", true).Error; err != nil { return err }
		return tx.First(&task, "id = ?", task.ID).Error
	})
	if err != nil { respondError(c, err); return }
	a.notify(currentUser(c).ID)
	c.JSON(200, task)
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
