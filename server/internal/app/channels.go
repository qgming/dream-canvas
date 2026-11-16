package app

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func openKey(root string) (cipher.AEAD, error) {
	name := filepath.Join(root, "credentials.key")
	key, err := os.ReadFile(name)
	if errors.Is(err, os.ErrNotExist) {
		key = make([]byte, 32)
		if _, err = rand.Read(key); err != nil { return nil, err }
		file, err := os.OpenFile(name, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil { return nil, err }
		_, writeErr := file.Write(key)
		if writeErr == nil { writeErr = file.Sync() }
		closeErr := file.Close()
		if writeErr != nil { return nil, writeErr }
		if closeErr != nil { return nil, closeErr }
	} else if err != nil { return nil, err }
	if len(key) != 32 { return nil, errors.New("credentials.key 无效，不能覆盖现有凭据加密密钥") }
	block, err := aes.NewCipher(key)
	if err != nil { return nil, err }
	return cipher.NewGCM(block)
}

func (a *App) encryptSecret(value string) (string, error) {
	nonce := make([]byte, a.credentials.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil { return "", err }
	return base64.StdEncoding.EncodeToString(a.credentials.Seal(nonce, nonce, []byte(value), nil)), nil
}

func (a *App) listChannels(c *gin.Context) {
	channels := []Channel{}
	models := []ChannelModel{}
	if err := a.db.Order("created_at").Find(&channels).Error; err != nil { respondError(c, err); return }
	if err := a.db.Order("created_at").Find(&models).Error; err != nil { respondError(c, err); return }
	result := []gin.H{}
	for _, channel := range channels {
		entries := []ChannelModel{}
		for _, model := range models { if model.ChannelID == channel.ID { entries = append(entries, model) } }
		result = append(result, gin.H{"channel": channel, "hasCredential": channel.Secret != "", "models": entries})
	}
	c.JSON(200, result)
}

func (a *App) modelCatalog(c *gin.Context) {
	result, err := a.ModelCatalog()
	if err != nil { respondError(c, err); return }
	c.JSON(200, result)
}

func (a *App) ModelCatalog() ([]gin.H, error) {
	channels := []Channel{}
	models := []ChannelModel{}
	if err := a.db.Where("enabled = ?", true).Order("created_at").Find(&channels).Error; err != nil { return nil, err }
	if err := a.db.Where("enabled = ?", true).Order("created_at").Find(&models).Error; err != nil { return nil, err }
	result := []gin.H{}
	for _, channel := range channels {
		if channel.Secret == "" { continue }
		entries := []gin.H{}
		for _, model := range models {
			if model.ChannelID == channel.ID { entries = append(entries, gin.H{"id": model.ID, "model": model.Model, "name": model.Name, "capability": model.Capability, "parameters": model.Parameters, "pricing": model.Pricing, "version": model.Version}) }
		}
		result = append(result, gin.H{"id": channel.ID, "name": channel.Name, "models": entries})
	}
	return result, nil
}

func (a *App) saveChannel(c *gin.Context) {
	var input struct { Name string `json:"name"`; BaseURL string `json:"baseUrl"`; Credential *string `json:"credential"`; Enabled bool `json:"enabled"`; Version uint64 `json:"version"` }
	if !bind(c, &input) { return }
	if err := validTitle(input.Name); err != nil { respondError(c, err); return }
	u, err := url.Parse(strings.TrimRight(strings.TrimSpace(input.BaseURL), "/"))
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" { respondError(c, problem(400, "invalid_url", "渠道地址需要完整 HTTPS 地址，不能包含凭据、查询参数或片段")); return }
	secret := ""
	if input.Credential != nil {
		if strings.TrimSpace(*input.Credential) == "" { respondError(c, problem(400, "credential_required", "渠道凭据不能为空")); return }
		secret, err = a.encryptSecret(strings.TrimSpace(*input.Credential))
		if err != nil { respondError(c, err); return }
	}
	var channel Channel
	err = a.db.Transaction(func(tx *gorm.DB) error {
		if c.Param("channelId") == "" {
			if secret == "" { return problem(400, "credential_required", "请输入渠道凭据") }
			channel = Channel{ID: identifier(), Name: strings.TrimSpace(input.Name), BaseURL: u.String(), Secret: secret, Enabled: input.Enabled, Version: 1}
			return tx.Create(&channel).Error
		}
		if err := tx.First(&channel, "id = ?", c.Param("channelId")).Error; err != nil { return err }
		if channel.Version != input.Version { return problem(409, "version_conflict", "渠道配置已更新，请重新读取") }
		values := map[string]any{"name": strings.TrimSpace(input.Name), "base_url": u.String(), "enabled": input.Enabled, "version": channel.Version + 1}
		if secret != "" { values["secret"] = secret }
		if err := tx.Model(&channel).Updates(values).Error; err != nil { return err }
		return tx.First(&channel, "id = ?", channel.ID).Error
	})
	if err != nil { respondError(c, err); return }
	a.notifyCatalog()
	c.JSON(200, gin.H{"channel": channel, "hasCredential": channel.Secret != ""})
}

type parameterControl struct {
	Key string `json:"key"`
	Label string `json:"label"`
	Type string `json:"type"`
	Required bool `json:"required"`
	Default any `json:"default"`
	Options []struct { Label string `json:"label"`; Value any `json:"value"` } `json:"options"`
	Role string `json:"role"`
}

func validateParameters(raw JSON) error {
	var controls []parameterControl
	if json.Unmarshal(raw, &controls) != nil || controls == nil { return problem(400, "invalid_parameters", "参数定义需要控件数组") }
	keys := map[string]bool{}
	for _, control := range controls {
		if strings.TrimSpace(control.Key) == "" || strings.TrimSpace(control.Label) == "" || keys[control.Key] { return problem(400, "invalid_parameters", "参数编号和名称不能为空，编号不能重复") }
		keys[control.Key] = true
		switch control.Type { case "text", "textarea", "number", "switch", "select", "asset": default: return problem(400, "invalid_parameters", "不支持的参数控件") }
		if control.Type == "select" && len(control.Options) == 0 { return problem(400, "invalid_parameters", "选择控件需要选项") }
		if control.Type == "asset" && control.Role != "image" && control.Role != "video" && control.Role != "audio" { return problem(400, "invalid_parameters", "素材控件需要明确图片、视频或音频角色") }
		options := map[string]bool{}
		for _, option := range control.Options {
			if strings.TrimSpace(option.Label) == "" { return problem(400, "invalid_parameters", "参数选项需要显示名称") }
			switch option.Value.(type) { case string, bool, float64: default: return problem(400, "invalid_parameters", "参数选项仅支持文本、数字或开关值") }
			if text, ok := option.Value.(string); ok && strings.TrimSpace(text) == "" { return problem(400, "invalid_parameters", "参数选项值不能为空") }
			encoded, _ := json.Marshal(option.Value)
			if options[string(encoded)] { return problem(400, "invalid_parameters", "参数选项值不能重复") }
			options[string(encoded)] = true
		}
		if control.Default != nil {
			if control.Type == "asset" { return problem(400, "invalid_parameters", "共享模型参数不能预设私人资产，请由用户选择") }
			if err := validateParameterValue(control, control.Default); err != nil { return err }
		}
	}
	return nil
}

func validateParameterValue(control parameterControl, value any) error {
	invalid := problem(400, "invalid_parameter", "参数「"+control.Label+"」的值不符合控件定义")
	switch control.Type {
	case "text", "textarea", "asset": if _, ok := value.(string); !ok { return invalid }
	case "number": if _, ok := value.(float64); !ok { return invalid }
	case "switch": if _, ok := value.(bool); !ok { return invalid }
	case "select":
		encoded, _ := json.Marshal(value)
		for _, option := range control.Options { candidate, _ := json.Marshal(option.Value); if string(encoded) == string(candidate) { return nil } }
		return invalid
	default: return invalid
	}
	return nil
}

func (a *App) saveChannelModel(c *gin.Context) {
	var input ChannelModel
	if !bind(c, &input) { return }
	if err := validTitle(input.Model); err != nil { respondError(c, err); return }
	if err := validTitle(input.Name); err != nil { respondError(c, err); return }
	protocols := map[string]string{"openai-chat": "text", "openai-responses": "text", "openai-image": "image", "seedance": "video", "minimax-video": "video", "minimax-audio": "audio", "custom": input.Capability}
	capability, ok := protocols[input.Protocol]
	if !ok || capability != input.Capability || (capability != "text" && capability != "image" && capability != "video" && capability != "audio") { respondError(c, problem(400, "invalid_protocol", "协议与模型能力不匹配")); return }
	if err := validateParameters(input.Parameters); err != nil { respondError(c, err); return }
	var pricing map[string]any
	if json.Unmarshal(input.Pricing, &pricing) != nil || pricing == nil { respondError(c, problem(400, "invalid_pricing", "价格定义需要对象；未配置时使用空对象")); return }
	var model ChannelModel
	err := a.db.Transaction(func(tx *gorm.DB) error {
		var channel Channel
		if err := tx.First(&channel, "id = ?", c.Param("channelId")).Error; err != nil { return err }
		var count int64
		if err := tx.Model(&ChannelModel{}).Where("channel_id = ? AND model = ? AND id <> ?", channel.ID, strings.TrimSpace(input.Model), c.Param("modelId")).Count(&count).Error; err != nil { return err }
		if count > 0 { return problem(409, "model_exists", "同一渠道不能重复配置相同模型 ID") }
		if c.Param("modelId") == "" {
			model = ChannelModel{ID: identifier(), ChannelID: channel.ID, Model: strings.TrimSpace(input.Model), Name: strings.TrimSpace(input.Name), Capability: input.Capability, Protocol: input.Protocol, Enabled: input.Enabled, Parameters: input.Parameters, Pricing: input.Pricing, Version: 1}
			return tx.Create(&model).Error
		}
		if err := tx.First(&model, "id = ? AND channel_id = ?", c.Param("modelId"), channel.ID).Error; err != nil { return err }
		if model.Version != input.Version { return problem(409, "version_conflict", "模型配置已更新，请重新读取") }
		publishedID := model.PublishedVersionID
		if input.Protocol != model.Protocol || input.Capability != model.Capability { publishedID = "" }
		if input.Protocol == "custom" && publishedID != "" {
			var published InterfaceVersion
			if err := tx.First(&published, "id = ? AND model_id = ?", publishedID, model.ID).Error; err != nil { return err }
			var actual, expected any
			if json.Unmarshal(input.Parameters, &actual) != nil || json.Unmarshal(published.Parameters, &expected) != nil { return problem(409, "invalid_parameters", "已发布接口的参数定义无法读取") }
			actualJSON, _ := json.Marshal(actual)
			expectedJSON, _ := json.Marshal(expected)
			if string(actualJSON) != string(expectedJSON) { return problem(409, "published_parameters", "自定义接口的参数需在接口草稿中修改并发布，不能单独修改已发布模型的参数") }
			input.Parameters = published.Parameters
		}
		if err := tx.Model(&model).Updates(map[string]any{"model": strings.TrimSpace(input.Model), "name": strings.TrimSpace(input.Name), "capability": input.Capability, "protocol": input.Protocol, "enabled": input.Enabled, "parameters": input.Parameters, "pricing": input.Pricing, "published_version_id": publishedID, "version": model.Version + 1}).Error; err != nil { return err }
		return tx.First(&model, "id = ?", model.ID).Error
	})
	if err != nil { respondError(c, err); return }
	a.notifyCatalog()
	c.JSON(200, model)
}

func (a *App) getInterface(c *gin.Context) {
	var model ChannelModel
	if err := a.db.First(&model, "id = ?", c.Param("modelId")).Error; err != nil { respondError(c, err); return }
	draft := InterfaceDraft{}
	err := a.db.First(&draft, "model_id = ?", model.ID).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) { respondError(c, err); return }
	if errors.Is(err, gorm.ErrRecordNotFound) { draft = InterfaceDraft{ModelID: model.ID, Scripts: JSON(`{"submit":"","query":"","result":"","usage":"","cancel":""}`), Parameters: model.Parameters} }
	versions := []InterfaceVersion{}
	if err := a.db.Where("model_id = ?", model.ID).Order("created_at DESC").Find(&versions).Error; err != nil { respondError(c, err); return }
	c.JSON(200, gin.H{"draft": draft, "versions": versions})
}

func validateScripts(raw JSON) error {
	var scripts map[string]string
	if json.Unmarshal(raw, &scripts) != nil || scripts == nil { return problem(400, "invalid_scripts", "脚本需要按提交、查询、结果、用量和取消分别保存") }
	for key := range scripts { if key != "submit" && key != "query" && key != "result" && key != "usage" && key != "cancel" { return problem(400, "invalid_scripts", "不支持的脚本入口") } }
	return nil
}

func (a *App) saveInterface(c *gin.Context) {
	var input InterfaceDraft
	if !bind(c, &input) { return }
	if err := validateScripts(input.Scripts); err != nil { respondError(c, err); return }
	if err := validateParameters(input.Parameters); err != nil { respondError(c, err); return }
	var draft InterfaceDraft
	err := a.db.Transaction(func(tx *gorm.DB) error {
		var model ChannelModel
		if err := tx.First(&model, "id = ? AND protocol = ?", c.Param("modelId"), "custom").Error; err != nil { return err }
		err := tx.First(&draft, "model_id = ?", model.ID).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			if input.Revision != 0 { return problem(409, "version_conflict", "草稿版本已变化，请重新读取") }
			draft = InterfaceDraft{ID: identifier(), ModelID: model.ID, Revision: 1, Scripts: input.Scripts, Parameters: input.Parameters, UpdatedBy: currentUser(c).ID}
			return tx.Create(&draft).Error
		}
		if err != nil { return err }
		if draft.Revision != input.Revision { return problem(409, "version_conflict", "接口草稿已更新，当前修改未保存") }
		if err := tx.Model(&draft).Updates(map[string]any{"scripts": input.Scripts, "parameters": input.Parameters, "revision": draft.Revision + 1, "updated_by": currentUser(c).ID}).Error; err != nil { return err }
		return tx.First(&draft, "id = ?", draft.ID).Error
	})
	if err != nil { respondError(c, err); return }
	c.JSON(200, draft)
}

func (a *App) publishInterface(c *gin.Context) {
	var input struct { Revision uint64 `json:"revision"`; ModelVersion uint64 `json:"modelVersion"` }
	if !bind(c, &input) { return }
	var version InterfaceVersion
	err := a.db.Transaction(func(tx *gorm.DB) error {
		var model ChannelModel
		var draft InterfaceDraft
		if err := tx.First(&model, "id = ? AND protocol = ?", c.Param("modelId"), "custom").Error; err != nil { return err }
		if model.Version != input.ModelVersion { return problem(409, "version_conflict", "模型已更新，请重新读取后发布") }
		if err := tx.First(&draft, "model_id = ?", model.ID).Error; err != nil { return err }
		if draft.Revision != input.Revision { return problem(409, "version_conflict", "草稿已更新，请重新读取后发布") }
		var scripts map[string]string
		if json.Unmarshal(draft.Scripts, &scripts) != nil || strings.TrimSpace(scripts["submit"]) == "" || strings.TrimSpace(scripts["result"]) == "" { return problem(400, "scripts_required", "发布前请填写提交和结果解析脚本") }
		version = InterfaceVersion{ID: identifier(), ModelID: model.ID, DraftRevision: draft.Revision, Scripts: draft.Scripts, Parameters: draft.Parameters, Verified: false, PublishedBy: currentUser(c).ID}
		if err := tx.Create(&version).Error; err != nil { return err }
		return tx.Model(&model).Updates(map[string]any{"published_version_id": version.ID, "parameters": version.Parameters, "version": model.Version + 1}).Error
	})
	if err != nil { respondError(c, err); return }
	a.notifyCatalog()
	c.JSON(201, version)
}
