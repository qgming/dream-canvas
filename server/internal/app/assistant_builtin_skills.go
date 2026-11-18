package app

import (
	_ "embed"
	"strings"

	"github.com/gin-gonic/gin"
)

//go:embed builtin_skills/model-api-adapter/SKILL.md
var modelAdapterInstructions string

const modelAdapterSkill = "model-api-adapter"

func builtinSkill(user User, name string) (AssistantSkill, bool) {
	if user.Role != "admin" || name != modelAdapterSkill { return AssistantSkill{}, false }
	return AssistantSkill{Name: name, Description: "适配模型 API、创作模式与参数 / Adapt model APIs, creation modes and parameters", Instructions: modelAdapterInstructions, Enabled: true, Version: 2, Interface: encode(map[string]string{"displayName": "模型 API 适配 / Model API adapter", "shortDescription": "按真实接口定义模式、参数与素材 / Define modes, parameters and media from API docs", "defaultPrompt": "$model-api-adapter 请根据供应商文档编写接口脚本草稿，核实支持的创作模式、参数与素材要求，并映射请求、结果和用量。"})}, true
}

func builtinSkillView(skill AssistantSkill, detail bool) gin.H {
	view := skillView(skill, detail); view["managed"], view["scope"], view["path"] = false, "admin", "builtin:"+skill.Name; return view
}

func (a *App) ListAssistantSkills(user User) ([]gin.H, error) {
	rows := []AssistantSkill{}; if err := a.db.Where("user_id = ?", user.ID).Order("name").Find(&rows).Error; err != nil { return nil, err }
	result := []gin.H{}; if skill, ok := builtinSkill(user, modelAdapterSkill); ok { result = append(result, builtinSkillView(skill, false)) }
	for _, row := range rows { if row.Name != modelAdapterSkill { result = append(result, skillView(row, false)) } }; return result, nil
}

func (a *App) resolveAssistantSkill(user User, name string, enabledOnly bool) (AssistantSkill, error) {
	if skill, ok := builtinSkill(user, name); ok { return skill, nil }
	if name == modelAdapterSkill { return AssistantSkill{}, problem(403, "admin_required", "此内置 Skill 仅限管理员") }
	var skill AssistantSkill; query := a.db.Where("user_id = ? AND name = ?", user.ID, name); if enabledOnly { query = query.Where("enabled = ?", true) }; err := query.First(&skill).Error; return skill, err
}

func (a *App) GetAssistantSkill(user User, name string) (gin.H, error) {
	skill, err := a.resolveAssistantSkill(user, name, false); if err != nil { return nil, err }; if _, ok := builtinSkill(user, name); ok { return builtinSkillView(skill, true), nil }; return skillView(skill, true), nil
}

func requestedBuiltinSkill(prompt string) string { if strings.Contains(prompt, "$"+modelAdapterSkill) { return modelAdapterSkill }; return "" }
