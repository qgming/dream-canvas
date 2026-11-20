package app

import (
	"encoding/json"
	"errors"
	"regexp"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func (a *App) listAssistantThreads(c *gin.Context) {
	threads := []AssistantThread{}
	if err := a.db.Where("user_id = ?", currentUser(c).ID).Order("updated_at DESC").Find(&threads).Error; err != nil { respondError(c, err); return }
	c.JSON(200, threads)
}

func (a *App) createAssistantThread(c *gin.Context) {
	var input struct { Title string `json:"title"` }
	if !bind(c, &input) { return }
	thread, err := a.CreateAssistantThread(currentUser(c).ID, input.Title); if err != nil { respondError(c, err); return }
	c.JSON(201, thread)
}

func (a *App) CreateAssistantThread(userID, title string) (AssistantThread, error) {
	if strings.TrimSpace(title) == "" { title = "新对话" }; thread := AssistantThread{ID: identifier(), UserID: userID, Title: strings.TrimSpace(title), Version: 1}
	err := a.db.Create(&thread).Error; if err == nil { a.notify(userID) }; return thread, err
}

func (a *App) getAssistantThread(c *gin.Context) {
	value, err := a.GetAssistantThread(currentUser(c).ID, c.Param("id")); if err != nil { respondError(c, err); return }; c.JSON(200, value)
}

func (a *App) GetAssistantThread(userID, id string) (gin.H, error) {
	var thread AssistantThread
	if err := a.db.First(&thread, "id = ? AND user_id = ?", id, userID).Error; err != nil { return nil, err }
	items := []AssistantItem{}
	turns := []AssistantTurn{}
	if err := a.db.Where("thread_id = ? AND user_id = ?", thread.ID, thread.UserID).Order("sequence").Find(&items).Error; err != nil { return nil, err }
	if err := a.db.Where("thread_id = ? AND user_id = ?", thread.ID, thread.UserID).Order("created_at").Find(&turns).Error; err != nil { return nil, err }
	prices := map[string]modelPricing{}
	for _, turn := range turns {
		var snapshot assistantSnapshot
		if json.Unmarshal(turn.Snapshot, &snapshot) == nil { prices[turn.ID], _ = parseModelPricing(snapshot.Execution.Model.Pricing) }
	}
	for index := range items {
		if items[index].Role != "assistant" || len(items[index].Detail) == 0 { continue }
		var detail map[string]any
		if json.Unmarshal(items[index].Detail, &detail) != nil { return nil, problem(409, "invalid_history", "历史消息无法读取，未覆盖或丢弃历史") }
		if usage, exists := detail["usage"]; exists { detail["usage"] = publicUsageValues(object(usage), prices[items[index].TurnID]); items[index].Detail = encode(detail) }
	}
	return gin.H{"thread": thread, "items": items, "turns": turns}, nil
}

func (a *App) deleteAssistantThread(c *gin.Context) {
	if err := a.DeleteAssistantThread(currentUser(c).ID, c.Param("id")); err != nil { respondError(c, err); return }; c.Status(204)
}

func (a *App) DeleteAssistantThread(userID, id string) error {
	err := a.db.Transaction(func(tx *gorm.DB) error {
		var thread AssistantThread
		if err := tx.First(&thread, "id = ? AND user_id = ?", id, userID).Error; err != nil { return err }
		var active int64
		if err := tx.Model(&AssistantTurn{}).Where("thread_id = ? AND status IN ?", thread.ID, []string{"queued", "running", "waiting_tasks"}).Count(&active).Error; err != nil { return err }
		if active > 0 { return problem(409, "thread_busy", "对话仍有执行中的轮次，请先停止并确认状态") }
		var pendingUsage int64; if err := tx.Model(&AssistantItem{}).Where("thread_id = ? AND json_extract(detail, '$.usageRecordPending') = ?", thread.ID, true).Count(&pendingUsage).Error; err != nil { return err }; if pendingUsage > 0 { return problem(409, "usage_pending", "对话仍有用量待补记，请待账本保存完成后再删除") }
		if err := tx.Delete(&AssistantItem{}, "thread_id = ? AND user_id = ?", thread.ID, thread.UserID).Error; err != nil { return err }
		if err := tx.Delete(&AssistantTurn{}, "thread_id = ? AND user_id = ?", thread.ID, thread.UserID).Error; err != nil { return err }
		return tx.Delete(&thread).Error
	})
	if err == nil { a.notify(userID) }; return err
}

type assistantTurnInput struct { Prompt string `json:"prompt"`; ProjectID string `json:"projectId"`; ClientID string `json:"clientId"`; ChannelID string `json:"channelId"`; ModelID string `json:"modelId"`; Skill string `json:"skill"`; Version uint64 `json:"version"`; Attachments []string `json:"attachments"`; References []string `json:"references"`; Parameters map[string]any `json:"parameters"` }

func (a *App) startAssistantTurn(c *gin.Context) {
	var input assistantTurnInput; if !bind(c, &input) { return }; turn, err := a.StartAssistantTurn(currentUser(c), c.Param("id"), input); if err != nil { respondError(c, err); return }; c.JSON(202, turn)
}

func (a *App) StartAssistantTurn(user User, id string, input assistantTurnInput) (AssistantTurn, error) {
	if strings.TrimSpace(input.Prompt) == "" { return AssistantTurn{}, problem(400, "prompt_required", "请输入消息") }
	if input.Skill == "" { input.Skill = requestedBuiltinSkill(input.Prompt) }
	var thread AssistantThread
	if err := a.db.First(&thread, "id = ? AND user_id = ?", id, user.ID).Error; err != nil { return AssistantTurn{}, err }
	if thread.Version != input.Version { return AssistantTurn{}, problem(409, "version_conflict", "对话已更新，请重新读取后发送") }
	if len(input.References) > 0 && input.ProjectID == "" { return AssistantTurn{}, problem(400, "project_required", "引用画布节点时需要明确目标项目") }
	if input.ProjectID != "" {
		project, err := a.GetProject(thread.UserID, input.ProjectID)
		if err != nil { return AssistantTurn{}, err }
		var document struct { Nodes []struct { ID string `json:"id"` } `json:"nodes"` }
		if json.Unmarshal(project.Document, &document) != nil { return AssistantTurn{}, problem(409, "invalid_document", "目标项目内容无法读取") }
		for _, id := range input.References {
			found := false
			for _, node := range document.Nodes { if node.ID == id { found = true; break } }
			if !found { return AssistantTurn{}, problem(409, "node_not_saved", "引用节点不在目标项目的已保存内容中，请先完成项目保存") }
		}
	}
	for _, id := range input.Attachments {
		var asset Asset
		if err := a.db.First(&asset, "id = ? AND user_id = ? AND kind = ? AND save_state = ? AND delete_state = ?", id, thread.UserID, "image", "saved", "").Error; err != nil { return AssistantTurn{}, problem(400, "invalid_attachment", "附件不存在、已删除、尚未保存或不是图片") }
	}
	if input.Skill != "" { if _, err := a.resolveAssistantSkill(user, input.Skill, true); err != nil { return AssistantTurn{}, err } }
	var model ChannelModel
	if err := a.db.First(&model, "id = ? AND channel_id = ? AND capability = ? AND enabled = ?", input.ModelID, input.ChannelID, "text", true).Error; err != nil { return AssistantTurn{}, err }
	var channel Channel
	if err := a.db.First(&channel, "id = ? AND enabled = ?", model.ChannelID, true).Error; err != nil { return AssistantTurn{}, err }
	if channel.Secret == "" { return AssistantTurn{}, problem(400, "credential_required", "此渠道尚未配置凭据") }
	if objectFromJSON(modelFeatures(a.db, model))["tools"] != true { return AssistantTurn{}, problem(400, "tools_required", "助手需要支持工具调用的文本适配") }
	policy, err := a.requireExecution()
	if err != nil { return AssistantTurn{}, err }
	if input.ClientID != "" { a.clients.Lock(); client, exists := a.clients.entries[input.ClientID]; a.clients.Unlock(); if !exists || client.UserID != thread.UserID || client.ProjectID != input.ProjectID || client.connection == "" { return AssistantTurn{}, problem(409, "client_offline", "绑定画布客户端已离线或切换项目，请重新读取后发送") } }
	return a.enqueueAssistantTurn(user, thread, input.Prompt, input.ProjectID, input.Skill, input.ClientID, input.Attachments, input.References, input.Parameters, channel, model, policy)
}

func (a *App) cancelAssistantTurn(c *gin.Context) {
	if err := a.CancelAssistantTurn(currentUser(c).ID, c.Param("id")); err != nil { respondError(c, err); return }; c.Status(204)
}

func (a *App) CancelAssistantTurn(userID, id string) error {
	var turn AssistantTurn
	err := a.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.First(&turn, "id = ? AND user_id = ?", id, userID).Error; err != nil { return err }
		if terminalTask(turn.Status) { return nil }
		if turn.Status == "running" { return tx.Model(&turn).Update("cancel_requested", true).Error }
		if err := tx.Model(&turn).Updates(map[string]any{"status": "cancelled", "cancel_requested": true}).Error; err != nil { return err }
		return tx.Model(&TaskAsset{}).Where("task_id = ?", "turn:"+turn.ID).Update("released", true).Error
	})
	if err != nil { return err }
	a.workMu.Lock(); if cancel := a.active["turn:"+turn.ID]; cancel != nil { cancel() }; a.workMu.Unlock()
	a.notify(userID); a.signalWork(); return nil
}

var skillName = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

func skillView(skill AssistantSkill, detail bool) gin.H {
	result := gin.H{"name": skill.Name, "description": skill.Description, "interface": skill.Interface, "path": "skill:"+skill.Name, "scope": "user", "enabled": skill.Enabled, "managed": true, "revision": strconv.FormatUint(skill.Version, 10)}
	if detail { result["instructions"] = skill.Instructions }
	return result
}

func (a *App) listAssistantSkills(c *gin.Context) {
	result, err := a.ListAssistantSkills(currentUser(c), c.Query("locale")); if err != nil { respondError(c, err); return }
	c.JSON(200, gin.H{"data": result, "errors": []string{}})
}

func (a *App) getAssistantSkill(c *gin.Context) {
	view, err := a.GetAssistantSkill(currentUser(c), c.Param("name"), c.Query("locale")); if err != nil { respondError(c, err); return }; c.JSON(200, gin.H{"data": view})
}

func (a *App) saveAssistantSkill(c *gin.Context) {
	var input skillInput
	if !bind(c, &input) { return }
	name := c.Param("name")
	if name == "" { name = input.Name }
	skill, err := a.SaveAssistantSkill(currentUser(c).ID, name, input, c.Request.Method == "POST")
	if err != nil { respondError(c, err); return }; c.JSON(200, gin.H{"data": skillView(skill, true)})
}

type skillInput struct { Name string `json:"name"`; Description string `json:"description"`; Instructions string `json:"instructions"`; Interface JSON `json:"interface"`; ExpectedRevision string `json:"expectedRevision"`; Enabled *bool `json:"enabled"` }

func (a *App) SaveAssistantSkill(userID, name string, input skillInput, create bool) (AssistantSkill, error) {
	if isBuiltinSkill(name) { return AssistantSkill{}, problem(403, "builtin_readonly", "内置 Skill 只读") }
	if !skillName.MatchString(name) { return AssistantSkill{}, problem(400, "invalid_skill_name", "Skill 标识需使用小写字母、数字与短横线") }
	if len(input.Interface) == 0 || string(input.Interface) == "null" { input.Interface = JSON(`{}`) }
	var metadata map[string]any
	if json.Unmarshal(input.Interface, &metadata) != nil || metadata == nil { return AssistantSkill{}, problem(400, "invalid_interface", "Skill 展示信息不正确") }
	for key, value := range metadata {
		if key != "displayName" && key != "shortDescription" && key != "defaultPrompt" { return AssistantSkill{}, problem(400, "invalid_interface", "Skill 展示信息含有不支持的字段") }
		if _, ok := value.(string); !ok { return AssistantSkill{}, problem(400, "invalid_interface", "Skill 展示信息需要文本") }
	}
	skill := AssistantSkill{UserID: userID, Name: name}
	err := a.db.Transaction(func(tx *gorm.DB) error {
		err := tx.First(&skill, "user_id = ? AND name = ?", skill.UserID, name).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			if !create || input.ExpectedRevision != "" { return problem(409, "version_conflict", "Skill 已变更，请重新读取") }
			if strings.TrimSpace(input.Description) == "" || strings.TrimSpace(input.Instructions) == "" { return problem(400, "skill_required", "请输入 Skill 描述与指令") }
			skill.Description, skill.Instructions, skill.Interface, skill.Enabled, skill.Version = input.Description, input.Instructions, input.Interface, true, 1
			return tx.Create(&skill).Error
		}
		if err != nil { return err }
		if input.ExpectedRevision != strconv.FormatUint(skill.Version, 10) { return problem(409, "version_conflict", "Skill 已更新，当前内容未覆盖服务端") }
		values := map[string]any{"version": skill.Version + 1}
		if input.Enabled != nil { values["enabled"] = *input.Enabled } else {
			if strings.TrimSpace(input.Description) == "" || strings.TrimSpace(input.Instructions) == "" { return problem(400, "skill_required", "请输入 Skill 描述与指令") }
			values["description"], values["instructions"], values["interface"] = input.Description, input.Instructions, input.Interface
		}
		if err := tx.Model(&skill).Updates(values).Error; err != nil { return err }
		return tx.First(&skill, "user_id = ? AND name = ?", skill.UserID, name).Error
	})
	if err == nil { a.notifyTopic(skill.UserID, "skills") }; return skill, err
}

func (a *App) deleteAssistantSkill(c *gin.Context) {
	var input struct { ExpectedRevision string `json:"expectedRevision"` }
	if !bind(c, &input) { return }
	if err := a.DeleteAssistantSkill(currentUser(c).ID, c.Param("name"), input.ExpectedRevision); err != nil { respondError(c, err); return }
	c.Status(204)
}

func (a *App) DeleteAssistantSkill(userID, name, revision string) error {
	if isBuiltinSkill(name) { return problem(403, "builtin_readonly", "内置 Skill 只读") }
	version, err := strconv.ParseUint(revision, 10, 64); if err != nil { return problem(400, "version_required", "请先读取 Skill 版本") }
	result := a.db.Delete(&AssistantSkill{}, "user_id = ? AND name = ? AND version = ?", userID, name, version)
	if result.Error != nil { return result.Error }; if result.RowsAffected == 0 { return problem(409, "version_conflict", "Skill 已更新或删除，请重新读取") }; a.notifyTopic(userID, "skills"); return nil
}
