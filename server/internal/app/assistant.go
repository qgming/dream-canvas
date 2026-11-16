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
	if strings.TrimSpace(input.Title) == "" { input.Title = "新对话" }
	thread := AssistantThread{ID: identifier(), UserID: currentUser(c).ID, Title: strings.TrimSpace(input.Title), Version: 1}
	if err := a.db.Create(&thread).Error; err != nil { respondError(c, err); return }
	a.notify(thread.UserID)
	c.JSON(201, thread)
}

func (a *App) getAssistantThread(c *gin.Context) {
	var thread AssistantThread
	if err := a.db.First(&thread, "id = ? AND user_id = ?", c.Param("id"), currentUser(c).ID).Error; err != nil { respondError(c, err); return }
	items := []AssistantItem{}
	turns := []AssistantTurn{}
	if err := a.db.Where("thread_id = ? AND user_id = ?", thread.ID, thread.UserID).Order("created_at").Find(&items).Error; err != nil { respondError(c, err); return }
	if err := a.db.Where("thread_id = ? AND user_id = ?", thread.ID, thread.UserID).Order("created_at").Find(&turns).Error; err != nil { respondError(c, err); return }
	c.JSON(200, gin.H{"thread": thread, "items": items, "turns": turns})
}

func (a *App) deleteAssistantThread(c *gin.Context) {
	err := a.db.Transaction(func(tx *gorm.DB) error {
		var thread AssistantThread
		if err := tx.First(&thread, "id = ? AND user_id = ?", c.Param("id"), currentUser(c).ID).Error; err != nil { return err }
		var active int64
		if err := tx.Model(&AssistantTurn{}).Where("thread_id = ? AND status IN ?", thread.ID, []string{"queued", "running", "waiting_approval"}).Count(&active).Error; err != nil { return err }
		if active > 0 { return problem(409, "thread_busy", "对话仍有执行中的轮次，请先停止并确认状态") }
		if err := tx.Delete(&AssistantItem{}, "thread_id = ? AND user_id = ?", thread.ID, thread.UserID).Error; err != nil { return err }
		if err := tx.Delete(&AssistantTurn{}, "thread_id = ? AND user_id = ?", thread.ID, thread.UserID).Error; err != nil { return err }
		return tx.Delete(&thread).Error
	})
	if err != nil { respondError(c, err); return }
	a.notify(currentUser(c).ID)
	c.Status(204)
}

func (a *App) startAssistantTurn(c *gin.Context) {
	var input struct { Prompt string `json:"prompt"`; ProjectID string `json:"projectId"`; ChannelID string `json:"channelId"`; ModelID string `json:"modelId"`; Skill string `json:"skill"`; Version uint64 `json:"version"`; Attachments []string `json:"attachments"`; References []string `json:"references"` }
	if !bind(c, &input) { return }
	if strings.TrimSpace(input.Prompt) == "" { respondError(c, problem(400, "prompt_required", "请输入消息")); return }
	var thread AssistantThread
	if err := a.db.First(&thread, "id = ? AND user_id = ?", c.Param("id"), currentUser(c).ID).Error; err != nil { respondError(c, err); return }
	if thread.Version != input.Version { respondError(c, problem(409, "version_conflict", "对话已更新，请重新读取后发送")); return }
	if len(input.References) > 0 && input.ProjectID == "" { respondError(c, problem(400, "project_required", "引用画布节点时需要明确目标项目")); return }
	if input.ProjectID != "" {
		project, err := a.GetProject(thread.UserID, input.ProjectID)
		if err != nil { respondError(c, err); return }
		var document struct { Nodes []struct { ID string `json:"id"` } `json:"nodes"` }
		if json.Unmarshal(project.Document, &document) != nil { respondError(c, problem(409, "invalid_document", "目标项目内容无法读取")); return }
		for _, id := range input.References {
			found := false
			for _, node := range document.Nodes { if node.ID == id { found = true; break } }
			if !found { respondError(c, problem(409, "node_not_saved", "引用节点不在目标项目的已保存内容中，请先完成项目保存")); return }
		}
	}
	for _, id := range input.Attachments {
		var asset Asset
		if err := a.db.First(&asset, "id = ? AND user_id = ? AND kind = ? AND save_state = ? AND delete_state = ?", id, thread.UserID, "image", "saved", "").Error; err != nil { respondError(c, problem(400, "invalid_attachment", "附件不存在、已删除、尚未保存或不是图片")); return }
	}
	if input.Skill != "" { var skill AssistantSkill; if err := a.db.First(&skill, "user_id = ? AND name = ? AND enabled = ?", thread.UserID, input.Skill, true).Error; err != nil { respondError(c, err); return } }
	var model ChannelModel
	if err := a.db.First(&model, "id = ? AND channel_id = ? AND capability = ? AND enabled = ?", input.ModelID, input.ChannelID, "text", true).Error; err != nil { respondError(c, err); return }
	var channel Channel
	if err := a.db.First(&channel, "id = ? AND enabled = ?", model.ChannelID, true).Error; err != nil { respondError(c, err); return }
	if channel.Secret == "" { respondError(c, problem(400, "credential_required", "此渠道尚未配置凭据")); return }
	respondError(c, executionUnavailable())
}

func (a *App) cancelAssistantTurn(c *gin.Context) {
	var turn AssistantTurn
	err := a.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.First(&turn, "id = ? AND user_id = ?", c.Param("id"), currentUser(c).ID).Error; err != nil { return err }
		if terminalTask(turn.Status) { return nil }
		if turn.Status != "queued" { return problem(409, "cancellation_unavailable", "当前轮次的执行取消尚未接入，不能宣称停止成功") }
		return tx.Model(&turn).Update("status", "cancelled").Error
	})
	if err != nil { respondError(c, err); return }
	a.notify(currentUser(c).ID)
	c.Status(204)
}

var skillName = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

func skillView(skill AssistantSkill, detail bool) gin.H {
	result := gin.H{"name": skill.Name, "description": skill.Description, "interface": skill.Interface, "path": "skill:"+skill.Name, "scope": "user", "enabled": skill.Enabled, "managed": true, "revision": strconv.FormatUint(skill.Version, 10)}
	if detail { result["instructions"] = skill.Instructions }
	return result
}

func (a *App) listAssistantSkills(c *gin.Context) {
	skills := []AssistantSkill{}
	if err := a.db.Where("user_id = ?", currentUser(c).ID).Order("name").Find(&skills).Error; err != nil { respondError(c, err); return }
	result := []gin.H{}
	for _, skill := range skills { result = append(result, skillView(skill, false)) }
	c.JSON(200, gin.H{"data": result, "errors": []string{}})
}

func (a *App) getAssistantSkill(c *gin.Context) {
	var skill AssistantSkill
	if err := a.db.First(&skill, "user_id = ? AND name = ?", currentUser(c).ID, c.Param("name")).Error; err != nil { respondError(c, err); return }
	c.JSON(200, gin.H{"data": skillView(skill, true)})
}

func (a *App) saveAssistantSkill(c *gin.Context) {
	var input struct { Name string `json:"name"`; Description string `json:"description"`; Instructions string `json:"instructions"`; Interface JSON `json:"interface"`; ExpectedRevision string `json:"expectedRevision"`; Enabled *bool `json:"enabled"` }
	if !bind(c, &input) { return }
	name := c.Param("name")
	if name == "" { name = input.Name }
	if !skillName.MatchString(name) { respondError(c, problem(400, "invalid_skill_name", "Skill 标识需使用小写字母、数字与短横线")); return }
	if len(input.Interface) == 0 || string(input.Interface) == "null" { input.Interface = JSON(`{}`) }
	var metadata map[string]any
	if json.Unmarshal(input.Interface, &metadata) != nil || metadata == nil { respondError(c, problem(400, "invalid_interface", "Skill 展示信息不正确")); return }
	for key, value := range metadata {
		if key != "displayName" && key != "shortDescription" && key != "defaultPrompt" { respondError(c, problem(400, "invalid_interface", "Skill 展示信息含有不支持的字段")); return }
		if _, ok := value.(string); !ok { respondError(c, problem(400, "invalid_interface", "Skill 展示信息需要文本")); return }
	}
	skill := AssistantSkill{UserID: currentUser(c).ID, Name: name}
	err := a.db.Transaction(func(tx *gorm.DB) error {
		err := tx.First(&skill, "user_id = ? AND name = ?", skill.UserID, name).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			if c.Request.Method != "POST" || input.ExpectedRevision != "" { return problem(409, "version_conflict", "Skill 已变更，请重新读取") }
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
	if err != nil { respondError(c, err); return }
	a.notify(skill.UserID)
	c.JSON(200, gin.H{"data": skillView(skill, true)})
}

func (a *App) deleteAssistantSkill(c *gin.Context) {
	var input struct { ExpectedRevision string `json:"expectedRevision"` }
	if !bind(c, &input) { return }
	version, err := strconv.ParseUint(input.ExpectedRevision, 10, 64)
	if err != nil { respondError(c, problem(400, "version_required", "请先读取 Skill 版本")); return }
	result := a.db.Delete(&AssistantSkill{}, "user_id = ? AND name = ? AND version = ?", currentUser(c).ID, c.Param("name"), version)
	if result.Error != nil { respondError(c, result.Error); return }
	if result.RowsAffected == 0 { respondError(c, problem(409, "version_conflict", "Skill 已更新或删除，请重新读取")); return }
	a.notify(currentUser(c).ID)
	c.Status(204)
}
