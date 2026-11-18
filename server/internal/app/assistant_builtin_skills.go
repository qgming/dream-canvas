package app

import (
	"embed"
	"encoding/json"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"
)

//go:embed builtin_skills/*/SKILL.md builtin_skills/film-production.md
var builtinSkillFiles embed.FS

const modelAdapterSkill = "model-api-adapter"

var builtinSkills = []AssistantSkill{
	newBuiltinSkill("short-film-production", "短剧与短片制作 / Short-drama and short-film production", "串联剧本、美术资产、分镜图片和视频镜头的画布制作流程 / Connect scripts, visual assets, storyboard images and video shots in a canvas workflow", "按实际需求接续各阶段并交付真实镜头 / Resume relevant production stages and deliver real shots", 1),
	newBuiltinSkill("short-drama-writing", "短剧编剧 / Short-drama writing", "将故事改编为短剧分集大纲与可拍单集剧本 / Adapt stories into episode outlines and shootable screenplays", "组织人物动机、冲突、对白与集尾悬念 / Develop motivation, conflict, dialogue and episode endings", 1),
	newBuiltinSkill("film-asset-design", "影视美术资产 / Film asset development", "拆解人物、场景与道具，制作可复用的视觉参考 / Break down cast, locations and props into reusable visual references", "建立场景空间、道具与服装状态 / Establish location geography, props and costume variants", 1),
	newBuiltinSkill("character-turnaround", "人物三视图 / Character turnaround", "从角色文本或基准图制作同一人物的正侧背参考 / Create consistent front, profile and back views from character text or an anchor", "先建立人物基准，再生成三视图与表情 / Create a character anchor, turnarounds and expressions", 1),
	newBuiltinSkill("storyboard-images", "文本生成分镜图片 / Script to storyboard images", "将剧本拆成镜头并在画布生成独立分镜图片 / Break a screenplay into shots and generate individual storyboard frames", "组织站位、镜头与真实角色场景参考 / Plan blocking and shots with real character and location references", 1),
	newBuiltinSkill("shot-video", "分镜转镜头视频 / Storyboard to video shots", "将分镜与首帧转成 Seedance 等已接入模型的视频镜头 / Turn storyboards and first frames into shots with configured models such as Seedance", "编排动作、表演、对白与跨镜衔接 / Direct action, performance, dialogue and shot handoffs", 1),
	newBuiltinSkill("minimax-h3-video", "MiniMax H3 音画镜头 / MiniMax H3 audiovisual shots", "为 MiniMax H3 编排文生、关键帧和多参考音画生成 / Write text, keyframe and multi-reference audiovisual prompts for MiniMax H3", "明确参考标签、说话人和完整音画正文 / Bind reference labels, speakers and complete audiovisual prompts", 1),
	newBuiltinSkill("film-continuity", "连戏检查与交付 / Continuity and handoff", "审查剧本分镜与提示词，整理缺镜和外部剪辑交接 / Review screenplay and prompt continuity and prepare an edit handoff", "逐镜定位穿帮、缺项与最小修改 / Locate continuity issues and missing work with shot-specific corrections", 1),
	newBuiltinSkill("canvas-composition", "画布编排 / Canvas composition", "在明确目标画布中组织创作节点与素材 / Organize creative nodes and media in an explicit target canvas", "按实际节点与素材整理创作流程 / Organize a workflow from real nodes and assets", 1),
	newBuiltinSkill(modelAdapterSkill, "模型 API 适配 / Model API adapter", "适配模型 API、创作模式与参数 / Adapt model APIs, creation modes and parameters", "按真实接口定义模式、参数与素材 / Define modes, parameters and media from API docs", 2),
}

func builtinSkillText(path string) string { content, err := builtinSkillFiles.ReadFile(path); if err != nil { panic(err) }; return string(content) }

func newBuiltinSkill(name, displayName, description, summary string, version uint64) AssistantSkill {
	instructions := builtinSkillText("builtin_skills/"+name+"/SKILL.md")
	if name != modelAdapterSkill { instructions += "\n\n"+builtinSkillText("builtin_skills/film-production.md") }
	return AssistantSkill{Name: name, Description: description, Instructions: instructions, Enabled: true, Version: version, Interface: encode(map[string]string{"displayName": displayName, "shortDescription": summary, "defaultPrompt": "$"+name})}
}

func isBuiltinSkill(name string) bool { for _, skill := range builtinSkills { if skill.Name == name { return true } }; return false }

func builtinSkill(user User, name string) (AssistantSkill, bool) {
	if name == modelAdapterSkill && user.Role != "admin" { return AssistantSkill{}, false }
	for _, skill := range builtinSkills { if skill.Name == name { return skill, true } }; return AssistantSkill{}, false
}

func builtinSkillView(skill AssistantSkill, detail bool, locale string) gin.H {
	localize := func(value string) string { zh, en, found := strings.Cut(value, " / "); if locale == "en-US" && found { return en }; return zh }
	skill.Description = localize(skill.Description)
	metadata := map[string]string{}; _ = json.Unmarshal(skill.Interface, &metadata)
	for _, key := range []string{"displayName", "shortDescription"} { metadata[key] = localize(metadata[key]) }; skill.Interface = encode(metadata)
	view := skillView(skill, detail); view["managed"], view["scope"], view["path"] = false, "builtin", "builtin:"+skill.Name; return view
}

func (a *App) ListAssistantSkills(user User, locale string) ([]gin.H, error) {
	rows := []AssistantSkill{}; if err := a.db.Where("user_id = ?", user.ID).Order("name").Find(&rows).Error; err != nil { return nil, err }
	result := []gin.H{}; for _, entry := range builtinSkills { if skill, ok := builtinSkill(user, entry.Name); ok { result = append(result, builtinSkillView(skill, false, locale)) } }
	for _, row := range rows { if !isBuiltinSkill(row.Name) { result = append(result, skillView(row, false)) } }; return result, nil
}

func (a *App) resolveAssistantSkill(user User, name string, enabledOnly bool) (AssistantSkill, error) {
	if skill, ok := builtinSkill(user, name); ok { return skill, nil }
	if name == modelAdapterSkill { return AssistantSkill{}, problem(403, "admin_required", "此内置 Skill 仅限管理员") }
	var skill AssistantSkill; query := a.db.Where("user_id = ? AND name = ?", user.ID, name); if enabledOnly { query = query.Where("enabled = ?", true) }; err := query.First(&skill).Error; return skill, err
}

func (a *App) GetAssistantSkill(user User, name, locale string) (gin.H, error) {
	skill, err := a.resolveAssistantSkill(user, name, false); if err != nil { return nil, err }; if _, ok := builtinSkill(user, name); ok { return builtinSkillView(skill, true, locale), nil }; return skillView(skill, true), nil
}

var builtinSkillMention = regexp.MustCompile(`\$([A-Za-z0-9_-]+)`)

func requestedBuiltinSkill(prompt string) string {
	for _, match := range builtinSkillMention.FindAllStringSubmatch(prompt, -1) { if isBuiltinSkill(match[1]) { return match[1] } }
	return ""
}
