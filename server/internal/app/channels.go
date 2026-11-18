package app

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"unicode/utf8"

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
	result, err := a.ListChannels(); if err != nil { respondError(c, err); return }; c.JSON(200, result)
}

func (a *App) ListChannels() ([]gin.H, error) {
	channels := []Channel{}
	models := []ChannelModel{}
	if err := a.db.Order("created_at").Find(&channels).Error; err != nil { return nil, err }
	if err := a.db.Order("created_at").Find(&models).Error; err != nil { return nil, err }
	for index := range models { if err := hydrateModel(a.db, &models[index]); err != nil { return nil, err } }
	result := []gin.H{}
	for _, channel := range channels {
		entries := []ChannelModel{}
		for _, model := range models { if model.ChannelID == channel.ID { entries = append(entries, model) } }
		result = append(result, gin.H{"channel": channel, "hasCredential": channel.Secret != "", "models": entries})
	}
	return result, nil
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
	for index := range models { if err := hydrateModel(a.db, &models[index]); err != nil { return nil, err } }
	result := []gin.H{}
	for _, channel := range channels {
		if channel.Secret == "" { continue }
		entries := []gin.H{}
		for _, model := range models {
			if model.ChannelID == channel.ID && model.AdapterVersionID != "" { entries = append(entries, gin.H{"id": model.ID, "model": model.Model, "name": model.Name, "adapterId": model.AdapterID, "capability": model.Capability, "features": modelFeatures(a.db, model), "parameters": model.Parameters, "pricing": model.Pricing, "version": model.Version}) }
		}
		if len(entries) > 0 { result = append(result, gin.H{"id": channel.ID, "name": channel.Name, "models": entries}) }
	}
	return result, nil
}

type channelInput struct { Name string `json:"name"`; BaseURL string `json:"baseUrl"`; Credential *string `json:"credential"`; Enabled bool `json:"enabled"`; Version uint64 `json:"version"` }

func (a *App) saveChannel(c *gin.Context) {
	var input channelInput; if !bind(c, &input) { return }; value, err := a.SaveChannel(c.Param("channelId"), input); if err != nil { respondError(c, err); return }; c.JSON(200, value)
}

func (a *App) SaveChannel(channelID string, input channelInput) (gin.H, error) {
	if err := validTitle(input.Name); err != nil { return nil, err }
	u, err := url.Parse(strings.TrimRight(strings.TrimSpace(input.BaseURL), "/"))
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" { return nil, problem(400, "invalid_url", "渠道地址需要完整 HTTPS 地址，不能包含凭据、查询参数或片段") }
	secret := ""
	if input.Credential != nil {
		if strings.TrimSpace(*input.Credential) == "" { return nil, problem(400, "credential_required", "渠道凭据不能为空") }
		secret, err = a.encryptSecret(strings.TrimSpace(*input.Credential))
		if err != nil { return nil, err }
	}
	var channel Channel
	err = a.db.Transaction(func(tx *gorm.DB) error {
		if channelID == "" {
			if secret == "" { return problem(400, "credential_required", "请输入渠道凭据") }
			channel = Channel{ID: identifier(), Name: strings.TrimSpace(input.Name), BaseURL: u.String(), Protocol: "openai-compatible", Secret: secret, Enabled: input.Enabled, Version: 1}
			return tx.Create(&channel).Error
		}
		if err := tx.First(&channel, "id = ?", channelID).Error; err != nil { return err }
		if channel.Version != input.Version { return problem(409, "version_conflict", "渠道配置已更新，请重新读取") }
		values := map[string]any{"name": strings.TrimSpace(input.Name), "base_url": u.String(), "protocol": "openai-compatible", "enabled": input.Enabled, "version": channel.Version + 1}
		if secret != "" { values["secret"] = secret }
		if err := tx.Model(&channel).Updates(values).Error; err != nil { return err }
		return tx.First(&channel, "id = ?", channel.ID).Error
	})
	if err != nil { return nil, err }
	a.notifyCatalog()
	return gin.H{"channel": channel, "hasCredential": channel.Secret != ""}, nil
}

func validHeaderName(name string) bool {
	if name == "" { return false }; for _, ch := range name { if !(ch >= 'a' && ch <= 'z' || ch >= 'A' && ch <= 'Z' || ch >= '0' && ch <= '9' || strings.ContainsRune("!#$%&'*+-.^_`|~", ch)) { return false } }; return true
}

type parameterOption struct { Label string `json:"label"`; LabelEn string `json:"labelEn,omitempty"`; Value any `json:"value"` }

type parameterControl struct {
	Key string `json:"key"`
	Label string `json:"label"`
	LabelEn string `json:"labelEn,omitempty"`
	Type string `json:"type"`
	Required bool `json:"required"`
	Default any `json:"default"`
	Options []parameterOption `json:"options"`
	Suggestions []parameterOption `json:"suggestions,omitempty"`
	Role string `json:"role"`
	Description string `json:"description,omitempty"`
	DescriptionEn string `json:"descriptionEn,omitempty"`
	Hidden bool `json:"hidden,omitempty"`
	Advanced bool `json:"advanced,omitempty"`
	Order int `json:"order,omitempty"`
	When *struct { Key string `json:"key"`; Values []any `json:"values"` } `json:"when,omitempty"`
	Min *float64 `json:"min,omitempty"`
	Max *float64 `json:"max,omitempty"`
	Step *float64 `json:"step,omitempty"`
	MinLength *int `json:"minLength,omitempty"`
	MaxLength *int `json:"maxLength,omitempty"`
	Transport string `json:"transport,omitempty"`
	MinCount int `json:"minCount,omitempty"`
	MaxCount *int `json:"maxCount,omitempty"`
	MimeTypes []string `json:"mimeTypes,omitempty"`
	MaxBytes int64 `json:"maxBytes,omitempty"`
	MinWidth int `json:"minWidth,omitempty"`
	MaxWidth int `json:"maxWidth,omitempty"`
	MinHeight int `json:"minHeight,omitempty"`
	MaxHeight int `json:"maxHeight,omitempty"`
	MinDurationMS int64 `json:"minDurationMs,omitempty"`
	MaxDurationMS int64 `json:"maxDurationMs,omitempty"`
}

func validateParameters(raw JSON, modelConfig ...bool) error {
	var controls []parameterControl
	if json.Unmarshal(raw, &controls) != nil || controls == nil { return problem(400, "invalid_parameters", "参数定义需要控件数组") }
	keys := map[string]bool{}
	for _, control := range controls {
		if strings.TrimSpace(control.Key) == "" || strings.TrimSpace(control.Label) == "" || keys[control.Key] { return problem(400, "invalid_parameters", "参数编号和名称不能为空，编号不能重复") }
		keys[control.Key] = true
		switch control.Type { case "text", "textarea", "number", "switch", "select", "asset", "reference": default: return problem(400, "invalid_parameters", "不支持的参数控件") }
		if control.Type == "select" && len(control.Options) == 0 { return problem(400, "invalid_parameters", "选择控件需要选项") }
		if (control.Type == "asset" || control.Type == "reference") && control.Role != "image" && control.Role != "video" && control.Role != "audio" { return problem(400, "invalid_parameters", "素材控件需要明确图片、视频或音频角色") }
		if control.Hidden && control.Required && control.Type != "reference" && control.Default == nil { return problem(400, "invalid_parameters", "隐藏的必填参数需要可用默认值") }
		for _, value := range []*float64{control.Min, control.Max, control.Step} { if value != nil && (math.IsNaN(*value) || math.IsInf(*value, 0)) { return problem(400, "invalid_parameters", "数值边界必须是有限数") } }
		if control.Min != nil && control.Max != nil && *control.Min > *control.Max || control.Step != nil && *control.Step <= 0 || control.MinLength != nil && *control.MinLength < 0 || control.MaxLength != nil && *control.MaxLength < 0 || control.MinCount < 0 || control.MaxCount != nil && *control.MaxCount < control.MinCount || control.MaxBytes < 0 || control.MinDurationMS < 0 || control.MaxDurationMS < 0 { return problem(400, "invalid_parameters", "参数范围或素材要求不正确") }
		if control.Transport != "" && !includes([]string{"https", "file", "data"}, control.Transport) { return problem(400, "invalid_parameters", "素材传递方式支持 https、file 或 data") }
		if control.MinLength != nil && control.MaxLength != nil && *control.MinLength > *control.MaxLength || control.MinWidth < 0 || control.MaxWidth < 0 || control.MinHeight < 0 || control.MaxHeight < 0 || control.MaxWidth > 0 && control.MinWidth > control.MaxWidth || control.MaxHeight > 0 && control.MinHeight > control.MaxHeight || control.MaxDurationMS > 0 && control.MinDurationMS > control.MaxDurationMS { return problem(400, "invalid_parameters", "素材或文本的最小值不能大于最大值") }
		for _, kind := range control.MimeTypes { if !strings.Contains(kind, "/") || strings.ContainsAny(kind, " \r\n;") { return problem(400, "invalid_parameters", "素材格式需要 MIME 类型，例如 image/png 或 image/*") } }
		if len(control.Options) > 0 && !includes([]string{"select", "text", "textarea", "number"}, control.Type) || len(control.Suggestions) > 0 && !includes([]string{"text", "textarea", "number"}, control.Type) { return problem(400, "invalid_parameters", "选项只适用于选择、文本或数字参数；建议值只适用于文本或数字参数") }
		options := map[string]bool{}
		for _, option := range append(append([]parameterOption{}, control.Options...), control.Suggestions...) {
			if strings.TrimSpace(option.Label) == "" { return problem(400, "invalid_parameters", "参数选项需要显示名称") }
			switch option.Value.(type) { case string, bool, float64: default: return problem(400, "invalid_parameters", "参数选项仅支持文本、数字或开关值") }
			if text, ok := option.Value.(string); ok && strings.TrimSpace(text) == "" { return problem(400, "invalid_parameters", "参数选项值不能为空") }
			if control.Type != "select" { unrestricted := control; unrestricted.Options = nil; if err := validateParameterValue(unrestricted, option.Value); err != nil { return err } }
			encoded, _ := json.Marshal(option.Value)
			if options[string(encoded)] { return problem(400, "invalid_parameters", "参数选项值不能重复") }
			options[string(encoded)] = true
		}
		if control.Default != nil {
			if control.Type == "asset" || control.Type == "reference" { return problem(400, "invalid_parameters", "共享模型参数不能预设私人资产，请由用户选择") }
			if err := validateParameterValue(control, control.Default); err != nil { return err }
		}
	}
	for _, control := range controls { if control.When != nil { if !keys[control.When.Key] || control.When.Key == control.Key || len(control.When.Values) == 0 { return problem(400, "invalid_parameter_condition", "显示条件需要其他已声明参数及匹配值") }; for _, source := range controls { if source.Key != control.When.Key { continue }; if source.When != nil || source.Type == "asset" || source.Type == "reference" { return problem(400, "invalid_parameter_condition", "显示条件应引用无条件的普通参数") }; if len(modelConfig) == 0 { for _, expected := range control.When.Values { if err := validateParameterValue(source, expected); err != nil { return problem(400, "invalid_parameter_condition", "条件值不符合引用参数的定义") } } } } } }
	for index, control := range controls { if control.Type != "reference" { continue }; for _, other := range controls[index+1:] { if other.Type != "reference" || other.Role != control.Role { continue }; overlap := control.When == nil || other.When == nil || control.When.Key != other.When.Key; if !overlap { for _, expected := range control.When.Values { for _, candidate := range other.When.Values { if string(encode(expected)) == string(encode(candidate)) { overlap = true } } } }; if overlap { return problem(400, "invalid_parameters", "同一模式和素材类型只能定义一个连接素材要求") } } }
	return nil
}

func validateParameterValue(control parameterControl, value any) error {
	invalid := problem(400, "invalid_parameter", "参数「"+control.Label+"」的值不符合控件定义")
	switch control.Type {
	case "text", "textarea", "asset": v, ok := value.(string); if !ok { return invalid }; count := utf8.RuneCountInString(v); if control.MinLength != nil && count < *control.MinLength || control.MaxLength != nil && count > *control.MaxLength { return invalid }
	case "number": v, ok := value.(float64); if !ok || math.IsNaN(v) || math.IsInf(v, 0) || control.Min != nil && v < *control.Min || control.Max != nil && v > *control.Max { return invalid }; if control.Step != nil { start := 0.0; if control.Min != nil { start = *control.Min }; steps := (v-start)/ *control.Step; if math.Abs(steps-math.Round(steps)) > 1e-9 { return invalid } }
	case "switch": if _, ok := value.(bool); !ok { return invalid }
	case "select":
	default: return invalid
	}
	if len(control.Options) > 0 {
		encoded, _ := json.Marshal(value)
		for _, option := range control.Options { candidate, _ := json.Marshal(option.Value); if string(encoded) == string(candidate) { return nil } }
		return invalid
	}
	return nil
}

func resolveParameters(definitions JSON, input map[string]any) (map[string]any, error) {
	var controls []parameterControl
	if json.Unmarshal(definitions, &controls) != nil { return nil, problem(409, "invalid_parameters", "模型参数定义无法读取，请联系管理员") }
	allowed := map[string]bool{}; for _, control := range controls { if control.Type != "reference" { allowed[control.Key] = true } }
	for key := range input { if !allowed[key] { return nil, problem(400, "undeclared_parameter", "模型未声明参数「"+key+"」，请重新读取模型配置") } }
	parameters := map[string]any{}
	for _, control := range controls { if value, exists := input[control.Key]; exists { parameters[control.Key] = value } else if control.Default != nil { parameters[control.Key] = control.Default } }
	for _, control := range controls {
		if control.Type == "reference" { continue }
		if !parameterVisible(control, parameters) { delete(parameters, control.Key); continue }
		value, exists := input[control.Key]; if !exists && control.Default != nil { value, exists = control.Default, true }
		if exists { parameters[control.Key] = value }
		if !exists || value == nil { if control.Required { return nil, problem(400, "parameter_required", "请填写参数「"+control.Label+"」") }; continue }
		if text, ok := value.(string); ok && strings.TrimSpace(text) == "" { if control.Required { return nil, problem(400, "parameter_required", "请填写参数「"+control.Label+"」") }; parameters[control.Key] = nil; continue }
		if err := validateParameterValue(control, value); err != nil { return nil, err }
	}
	return parameters, nil
}

func (a *App) saveChannelModel(c *gin.Context) {
	var input ChannelModel; if !bind(c, &input) { return }; model, err := a.SaveChannelModel(c.Param("channelId"), c.Param("modelId"), input); if err != nil { respondError(c, err); return }; c.JSON(200, model)
}

func (a *App) prepareChannelModel(input ChannelModel) (ChannelModel, error) {
    if err := validTitle(input.Model); err != nil { return input, err }
    if err := validTitle(input.Name); err != nil { return input, err }
    if !includes([]string{"text", "image", "video", "audio"}, input.Capability) { return input, problem(400, "invalid_capability", "请选择模型类型") }
    if input.AdapterID == "" { input.AdapterID = defaultAdapter(input.Capability) }
    var script ModelScript; var selected ScriptVersion
    if err := a.db.First(&script, "id = ? AND capability = ?", input.AdapterID, input.Capability).Error; err != nil { return input, problem(400, "script_required", "请选择与模型类型一致的调用方式") }
    if input.AdapterVersionID == "" { input.AdapterVersionID = script.AdapterVersionID }
    if input.AdapterVersionID == "" { return input, problem(400, "script_unpublished", "接口脚本尚未发布") }
    if err := a.db.First(&selected, "id = ? AND adapter_id = ?", input.AdapterVersionID, script.ID).Error; err != nil { return input, err }
    if len(input.ParameterOverrides) == 0 { input.ParameterOverrides = JSON(`{}`) }
    definitions, err := effectiveParameters(selected.Parameters, input.ParameterOverrides); if err != nil { return input, err }; input.Parameters = definitions
    if len(input.Pricing) == 0 { input.Pricing = JSON(`{}`) }
    var pricing map[string]any
    if json.Unmarshal(input.Pricing, &pricing) != nil || pricing == nil { return input, problem(400, "invalid_pricing", "价格定义需要对象") }
    if err := validatePricing(pricing); err != nil { return input, err }
    input.Model, input.Name = strings.TrimSpace(input.Model), strings.TrimSpace(input.Name)
    return input, nil
}

func writeChannelModel(tx *gorm.DB, channelID, modelID string, input ChannelModel) (ChannelModel, error) {
    var channel Channel; var model ChannelModel
    if err := tx.First(&channel, "id = ?", channelID).Error; err != nil { return model, err }
    var count int64
    if err := tx.Model(&ChannelModel{}).Where("channel_id = ? AND model = ? AND id <> ?", channel.ID, input.Model, modelID).Count(&count).Error; err != nil { return model, err }
    if count > 0 { return model, problem(409, "model_exists", "同一渠道不能重复配置相同模型 ID："+input.Model) }
    if modelID == "" { input.ID, input.ChannelID, input.Version = identifier(), channel.ID, 1; return input, tx.Create(&input).Error }
    if err := tx.First(&model, "id = ? AND channel_id = ?", modelID, channel.ID).Error; err != nil { return model, err }
    if model.Version != input.Version { return model, problem(409, "version_conflict", "模型已更新，当前编辑未覆盖") }
    if err := tx.Model(&model).Updates(map[string]any{"model": input.Model, "name": input.Name, "capability": input.Capability, "adapter_id": input.AdapterID, "adapter_version_id": input.AdapterVersionID, "enabled": input.Enabled, "parameter_overrides": input.ParameterOverrides, "pricing": input.Pricing, "version": model.Version+1}).Error; err != nil { return model, err }
    err := tx.First(&model, "id = ?", model.ID).Error; return model, err
}

func (a *App) SaveChannelModel(channelID, modelID string, input ChannelModel) (ChannelModel, error) {
    prepared, err := a.prepareChannelModel(input); if err != nil { return input, err }
    var model ChannelModel
    err = a.db.Transaction(func(tx *gorm.DB) error { var err error; model, err = writeChannelModel(tx, channelID, modelID, prepared); return err })
    if err == nil { err = hydrateModel(a.db, &model); a.notifyCatalog() }; return model, err
}

func (a *App) saveChannelModels(c *gin.Context) {
    var input struct { Models []ChannelModel `json:"models"` }; if !bind(c, &input) { return }
    models, err := a.SaveChannelModels(c.Param("channelId"), input.Models); if err != nil { respondError(c, err); return }; c.JSON(201, models)
}

func (a *App) SaveChannelModels(channelID string, rows []ChannelModel) ([]ChannelModel, error) {
    if len(rows) == 0 { return nil, problem(400, "models_required", "请选择或填写模型") }
    prepared := make([]ChannelModel, len(rows)); seen := map[string]bool{}
    rowError := func(index int, err error) error { status := 400; var failure *Problem; if errors.As(err, &failure) { status = failure.Status }; return problem(status, "model_row_"+strconv.Itoa(index), "模型 / Model "+rows[index].Model+": "+err.Error()) }
    for index, input := range rows { value, err := a.prepareChannelModel(input); if err != nil { return nil, rowError(index, err) }; if seen[value.Model] { return nil, rowError(index, problem(409, "model_exists", "待添加列表存在重复模型 ID / Duplicate model ID")) }; seen[value.Model] = true; prepared[index] = value }
    result := []ChannelModel{}
    err := a.db.Transaction(func(tx *gorm.DB) error { for index, input := range prepared { model, err := writeChannelModel(tx, channelID, "", input); if err != nil { return rowError(index, err) }; model.Parameters = input.Parameters; result = append(result, model) }; return nil })
    if err == nil { a.notifyCatalog() }; return result, err
}
