package app

import (
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type channelTemplate struct {
	ID string `json:"id"`
	Name string `json:"name"`
	BaseURL string `json:"baseUrl"`
	Documentation string `json:"documentation"`
	Models []ChannelModel `json:"models"`
}

func channelTemplates() []channelTemplate {
    definitions, _ := builtinScripts()
    model := func(id, name, adapterID string) ChannelModel {
        for _, script := range definitions { if script.ID == adapterID { return ChannelModel{Model: id, Name: name, Capability: script.Capability, AdapterID: script.ID, AdapterVersionID: builtinVersionID(script), ParameterOverrides: JSON(`{}`), Parameters: script.Parameters, Pricing: JSON(`{}`)} } }
        return ChannelModel{}
    }
    return []channelTemplate{
        {ID: "openai", Name: "OpenAI API", BaseURL: "https://api.openai.com/v1", Documentation: "https://developers.openai.com/api/docs", Models: []ChannelModel{model("gpt-4.1-mini", "OpenAI Chat Completions", "openai-chat"), model("gpt-4.1", "OpenAI Responses", "openai-responses"), model("gpt-image-2", "OpenAI Images", "openai-image"), model("gpt-4o-mini-tts", "OpenAI TTS", "openai-tts")}},
        {ID: "seedance", Name: "Seedance", BaseURL: "https://ark.cn-beijing.volces.com/api/v3", Documentation: "https://www.volcengine.com/docs/82379/1520757", Models: []ChannelModel{model("doubao-seedance-1-0-pro-250528", "Seedance", "seedance")}},
        {ID: "minimax", Name: "MiniMax Video", BaseURL: "https://api.minimax.cn/v1", Documentation: "https://platform.minimaxi.com/docs/api-reference/video-generation-v2-create", Models: []ChannelModel{model("MiniMax-H3", "MiniMax H3", "minimax-video-v2")}},
    }
}

func (a *App) listChannelTemplates(c *gin.Context) { c.JSON(200, channelTemplates()) }

func (a *App) installChannelTemplate(c *gin.Context) {
	var input struct { Credential string `json:"credential"`; Name string `json:"name"` }
	if !bind(c, &input) { return }
	value, err := a.InstallChannelTemplate(c.Param("template"), input.Name, input.Credential); if err != nil { respondError(c, err); return }; c.JSON(201, value)
}

func (a *App) InstallChannelTemplate(id, name, credential string) (gin.H, error) {
	if strings.TrimSpace(credential) == "" { return nil, problem(400, "credential_required", "请输入渠道凭据") }
	var template *channelTemplate
	for _, item := range channelTemplates() { if item.ID == id { value := item; template = &value; break } }
	if template == nil { return nil, problem(404, "template_missing", "渠道模板不存在") }
	secret, err := a.encryptSecret(strings.TrimSpace(credential))
	if err != nil { return nil, err }
	name = strings.TrimSpace(name)
	if name == "" { name = template.Name }
	channel := Channel{ID: identifier(), Name: name, BaseURL: template.BaseURL, Protocol: "openai-compatible", Secret: secret, Enabled: true, Version: 1}
	err = a.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&channel).Error; err != nil { return err }
		for _, definition := range template.Models {
			definition.ID, definition.ChannelID, definition.Version = identifier(), channel.ID, 1
			if err := tx.Create(&definition).Error; err != nil { return err }
		}
		return nil
	})
	if err != nil { return nil, err }
	a.notifyCatalog()
	return gin.H{"channel": channel, "hasCredential": true}, nil
}
