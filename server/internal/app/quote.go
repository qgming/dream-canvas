package app

import (
	"encoding/json"
	"math/big"
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
)

type generationQuoteInput struct {
	ChannelID string `json:"channelId"`
	ModelID string `json:"modelId"`
	Parameters JSON `json:"parameters"`
	Prompt string `json:"prompt,omitempty"`
	Messages JSON `json:"messages,omitempty"`
	Requests *int `json:"requests,omitempty"`
}

type generationQuoteResult struct {
	PointsMilli *string `json:"pointsMilli"`
	State string `json:"state"`
	Quantity map[string]string `json:"quantity,omitempty"`
}

func (a *App) quoteUsage(c *gin.Context) {
	var input generationQuoteInput
	if !bind(c, &input) { return }
	value, err := a.GenerationQuote(Principal{User: currentUser(c)}, input)
	if err != nil { respondError(c, err); return }
	c.JSON(200, value)
}

func (a *App) GenerationQuote(principal Principal, input generationQuoteInput) (generationQuoteResult, error) {
	requestCount := 1
	if input.Requests != nil { if *input.Requests <= 0 { return generationQuoteResult{}, problem(400, "invalid_requests", "requests 需要正整数") }; requestCount = *input.Requests }
	var channel Channel; var model ChannelModel
	if err := a.db.First(&channel, "id = ? AND enabled = ?", input.ChannelID, true).Error; err != nil { return generationQuoteResult{}, problem(400, "invalid_model", "渠道不存在或已停用") }
	if channel.Secret == "" { return generationQuoteResult{}, problem(400, "invalid_model", "渠道尚未配置凭据") }
	if err := a.db.First(&model, "id = ? AND channel_id = ? AND enabled = ?", input.ModelID, channel.ID, true).Error; err != nil { return generationQuoteResult{}, problem(400, "invalid_model", "模型不存在或已停用") }
	if model.AdapterVersionID == "" { return generationQuoteResult{}, problem(400, "interface_unpublished", "接口脚本尚未发布") }
	if err := hydrateModel(a.db, &model); err != nil { return generationQuoteResult{}, err }
	requested := map[string]any{}
	if json.Unmarshal(input.Parameters, &requested) != nil || requested == nil { return generationQuoteResult{}, problem(400, "invalid_parameters", "参数需要对象") }
	parameters, err := resolveParameters(model.Parameters, requested)
	if err != nil { return generationQuoteResult{}, err }
	messageText, references, err := quoteMessageText(input.Messages)
	if err != nil { return generationQuoteResult{}, err }
	var controls []parameterControl
	if json.Unmarshal(model.Parameters, &controls) != nil { return generationQuoteResult{}, problem(409, "invalid_parameters", "模型参数定义无法读取，请联系管理员") }
	for _, control := range controls {
		if control.Type != "asset" || !parameterVisible(control, parameters) { continue }
		if id, ok := parameters[control.Key].(string); ok && id != "" { references = append(references, assetInput{AssetID: id, Role: control.Role}) }
	}
	for _, reference := range references { if err := a.checkTokenAsset(principal, reference.AssetID); err != nil { return generationQuoteResult{}, err } }
	if err := snapshotAssetInputs(a.db, principal.User.ID, channel.ID, references); err != nil { return generationQuoteResult{}, err }
	pricing, err := parseModelPricing(model.Pricing)
	if err != nil { return generationQuoteResult{}, err }
	rates := ratesForParameters(pricing, parameters)
	quantities, labels := quoteQuantities(rates, parameters, strings.TrimSpace(input.Prompt), messageText, requestCount)
	result := generationQuoteResult{State: "unknown", Quantity: labels}
	if len(rates) == 0 || len(quantities) != len(rates) { return result, nil }
	_, points, _ := rateTotals(quantities, rates, pricing, pointsRatioFromDB(a.db))
	if points == nil { return result, nil }
	value := big.NewInt(*points).String(); result.PointsMilli, result.State = &value, "estimated"
	return result, nil
}

func quoteMessageText(raw JSON) (string, []assetInput, error) {
	if len(raw) == 0 { return "", nil, nil }
	var messages []map[string]any
	if json.Unmarshal(raw, &messages) != nil || len(messages) == 0 { return "", nil, problem(400, "invalid_messages", "消息需要非空数组") }
	var result strings.Builder
	references := []assetInput{}
	for _, message := range messages {
		role, _ := message["role"].(string)
		if role != "system" && role != "user" && role != "assistant" { return "", nil, problem(400, "invalid_messages", "消息角色不正确") }
		switch content := message["content"].(type) {
		case string:
			if strings.TrimSpace(content) == "" { return "", nil, problem(400, "invalid_messages", "消息文本不能为空") }
			result.WriteString(content)
		case []any:
			if len(content) == 0 { return "", nil, problem(400, "invalid_messages", "消息内容不能为空") }
			for _, item := range content {
				part := object(item)
				switch part["type"] {
				case "text":
					value, ok := part["text"].(string); if !ok || strings.TrimSpace(value) == "" { return "", nil, problem(400, "invalid_messages", "消息文本不正确") }; result.WriteString(value)
				case "image_asset":
					id := text(part["assetId"]); if id == "" { return "", nil, problem(400, "invalid_messages", "消息图片需要资产 ID") }; references = append(references, assetInput{AssetID: id, Role: "image"})
				default:
					return "", nil, problem(400, "invalid_messages", "消息包含不支持的内容")
				}
			}
		default:
			return "", nil, problem(400, "invalid_messages", "消息内容不正确")
		}
	}
	return result.String(), references, nil
}

func quoteQuantities(rates map[string]pricingRate, parameters map[string]any, prompt, messages string, requests int) (map[string]*big.Rat, map[string]string) {
	quantities, labels := map[string]*big.Rat{}, map[string]string{}
	requestValue := new(big.Rat).SetInt64(int64(requests))
	for unit := range rates {
		quantity := new(big.Rat).Set(requestValue)
		switch unit {
		case "requests":
		case "images":
			value := parameters["count"]; if value == nil { value = parameters["n"] }
			count, ok := decimalValue(text(value)); if !ok { continue }; quantity.Mul(quantity, count)
		case "seconds":
			value := parameters["seconds"]; if value == nil { value = parameters["duration"] }
			seconds, ok := decimalValue(text(value)); if !ok { continue }; quantity.Mul(quantity, seconds)
		case "characters":
			content := prompt + messages
			if content == "" { continue }
			quantity.Mul(quantity, new(big.Rat).SetInt64(int64(utf8.RuneCountInString(content))))
		default:
			continue
		}
		quantities[unit] = quantity
		labels[unit] = decimalText(quantity, 6)
	}
	return quantities, labels
}
