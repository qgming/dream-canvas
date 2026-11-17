package app

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type scriptTestInput struct {
	ChannelID string `json:"channelId"`
	Model ChannelModel `json:"model"`
	Revision uint64 `json:"revision"`
	Prompt string `json:"prompt"`
	Parameters map[string]any `json:"parameters"`
	References []assetInput `json:"references"`
	ConfirmCharges bool `json:"confirmCharges"`
}

func (a *App) testModelScript(c *gin.Context) { var input scriptTestInput; if !bind(c, &input) { return }; task, err := a.TestModelScript(currentUser(c), c.Param("adapterId"), input); if err != nil { respondError(c, err); return }; c.JSON(202, task) }

func (a *App) TestModelScript(user User, adapterID string, input scriptTestInput) (GenerationTask, error) {
	if !input.ConfirmCharges { return GenerationTask{}, problem(400, "charges_confirmation_required", "真实测试可能产生供应商费用，请主动确认") }
	if strings.TrimSpace(input.Prompt) == "" { return GenerationTask{}, problem(400, "prompt_required", "请输入测试提示词") }
	policy, err := a.requireExecution(); if err != nil { return GenerationTask{}, err }
	var channel Channel; if err := a.db.First(&channel, "id = ?", input.ChannelID).Error; err != nil { return GenerationTask{}, err }
	if channel.Secret == "" { return GenerationTask{}, problem(400, "credential_required", "渠道尚未配置凭据") }
	var script ModelScript; if err := a.db.First(&script, "id = ?", adapterID).Error; err != nil { return GenerationTask{}, err }
	model := input.Model; if model.Capability != script.Capability { return GenerationTask{}, problem(400, "invalid_capability", "模型与脚本类型不一致") }
	if err := validTitle(model.Model); err != nil { return GenerationTask{}, err }; if err := validTitle(model.Name); err != nil { return GenerationTask{}, err }
	model.ChannelID, model.AdapterID = channel.ID, script.ID
	var version ScriptVersion
	if input.Revision > 0 {
		if script.Builtin { return GenerationTask{}, problem(403, "builtin_readonly", "内置脚本只能测试已发布版本") }
		var draft ScriptDraft; if err := a.db.First(&draft, "adapter_id = ? AND revision = ?", script.ID, input.Revision).Error; err != nil { return GenerationTask{}, problem(409, "version_conflict", "草稿已更新，请重新读取") }
		scripts, definitions, err := compileScriptPackage(draft.Files); if err != nil { return GenerationTask{}, err }
		version = ScriptVersion{ID: "test-"+digest(string(draft.Files)), AdapterID: script.ID, DraftRevision: draft.Revision, Files: draft.Files, Scripts: scripts, Parameters: definitions, Features: scriptFeatures(draft.Files), PublishedBy: user.ID}
	} else {
		if model.AdapterVersionID == "" { model.AdapterVersionID = script.AdapterVersionID }
		if err := a.db.First(&version, "id = ? AND adapter_id = ?", model.AdapterVersionID, script.ID).Error; err != nil { return GenerationTask{}, err }
	}
	model.AdapterVersionID = version.ID
	model.Parameters, err = effectiveParameters(version.Parameters, model.ParameterOverrides); if err != nil { return GenerationTask{}, err }
	if len(model.Pricing) == 0 { model.Pricing = JSON(`{}`) }; var pricing map[string]any; if json.Unmarshal(model.Pricing, &pricing) != nil || pricing == nil { return GenerationTask{}, problem(400, "invalid_pricing", "价格配置无效") }; if err := validatePricing(pricing); err != nil { return GenerationTask{}, err }
	parameters, err := resolveParameters(model.Parameters, input.Parameters); if err != nil { return GenerationTask{}, err }
	request := generationInput{ChannelID: channel.ID, ModelID: model.ID, Capability: model.Capability, Prompt: input.Prompt, Parameters: encode(parameters), References: input.References, BatchID: identifier()}
	var controls []parameterControl; _ = json.Unmarshal(model.Parameters, &controls)
	for _, control := range controls { if control.Type != "asset" || !parameterVisible(control, parameters) { continue }; id, _ := parameters[control.Key].(string); if id == "" { continue }; found := false; for _, reference := range request.References { if reference.AssetID == id && reference.Role == control.Role { found = true } }; if !found { request.References = append(request.References, assetInput{AssetID: id, Role: control.Role}) } }
	if err := snapshotAssetInputs(a.db, user.ID, channel.ID, request.References); err != nil { return GenerationTask{}, err }
	snapshot := executionSnapshot{ChannelID: channel.ID, ChannelVersion: channel.Version, BaseURL: channel.BaseURL, Credential: channel.Secret, Model: model, Script: &version, Policy: policy}
	if err := a.validateReferenceMedia(snapshot, request, user.ID); err != nil { return GenerationTask{}, err }; if err := a.validateScriptInput(user.ID, snapshot, request); err != nil { return GenerationTask{}, err }
	task := GenerationTask{ID: identifier(), UserID: user.ID, ChannelID: channel.ID, ModelID: model.ID, Capability: model.Capability, Snapshot: encode(snapshot), Input: encode(request), Status: "queued", AssetIDs: JSON(`[]`), UsageState: "unknown", DebugRevision: version.DraftRevision}
	err = a.db.Transaction(func(tx *gorm.DB) error { for _, reference := range request.References { var asset Asset; if err := tx.First(&asset, "id = ? AND user_id = ? AND save_state = ? AND delete_state = ?", reference.AssetID, user.ID, "saved", "").Error; err != nil { return err }; if err := tx.FirstOrCreate(&TaskAsset{TaskID: task.ID, AssetID: asset.ID}).Error; err != nil { return err } }; return tx.Create(&task).Error })
	if err == nil { a.signalWork(); a.notify(user.ID) }; return task, err
}

func (a *App) discoverChannelModels(c *gin.Context) { rows, err := a.DiscoverChannelModels(c.Request.Context(), c.Param("channelId")); if err != nil { respondError(c, err); return }; c.JSON(200, rows) }

func (a *App) DiscoverChannelModels(parent context.Context, channelID string) ([]string, error) {
	var channel Channel; if err := a.db.First(&channel, "id = ?", channelID).Error; err != nil { return nil, err }
	policy, err := a.executionPolicy(); if err != nil { return nil, err }
	ctx, cancel := context.WithTimeout(parent, seconds(policy.QuerySeconds)); defer cancel()
	client, err := a.providerClient(executionSnapshot{BaseURL: channel.BaseURL, Credential: channel.Secret, Policy: policy}); if err != nil { return nil, err }
	var response *http.Response; if err := client.Execute(ctx, "GET", "models", nil, &response); err != nil { return nil, problem(502, "models_discovery_failed", "拉取模型失败，请核对地址、凭据，或手动填写模型 ID") }; defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, policy.JSONBytes+1)); if err != nil || int64(len(data)) > policy.JSONBytes { return nil, problem(502, "models_discovery_failed", "模型列表读取失败或超过已配置 JSON 边界") }
	var value struct { Data []struct { ID string `json:"id"` } `json:"data"` }; if json.Unmarshal(data, &value) != nil || value.Data == nil { return nil, problem(502, "models_discovery_failed", "服务未返回 OpenAI 模型列表，可手动填写") }
	rows := []string{}; seen := map[string]bool{}; for _, model := range value.Data { if strings.TrimSpace(model.ID) != "" && !seen[model.ID] { rows = append(rows, model.ID); seen[model.ID] = true } }; return rows, nil
}

type scriptCheckInput struct { Files JSON `json:"files"`; Input map[string]any `json:"input"`; BaseURL string `json:"baseUrl"` }

func (a *App) checkModelScript(c *gin.Context) {
	var input scriptCheckInput; if !bind(c, &input) { return }
	result, err := a.CheckModelScript(c.Request.Context(), currentUser(c).ID, input); if err != nil { respondError(c, err); return }; c.JSON(200, result)
}

func (a *App) CheckModelScript(ctx context.Context, userID string, input scriptCheckInput) (gin.H, error) {
	scripts, parameters, err := compileScriptPackage(input.Files); if err != nil { return nil, err }
	result := gin.H{"valid": true, "parameters": parameters, "features": scriptFeatures(input.Files)}
	if input.Input != nil {
		policy, err := a.executionPolicy(); if err != nil { return nil, err }
		var stages map[string]string; _ = json.Unmarshal(scripts, &stages)
		params, err := resolveParameters(parameters, object(input.Input["params"])); if err != nil { return nil, err }; input.Input["params"] = params
		for _, key := range []string{"images", "videos", "audios", "messages", "tools"} { if input.Input[key] == nil { input.Input[key] = []any{} } }
		snapshot := executionSnapshot{Policy: policy, Model: ChannelModel{Model: text(input.Input["model"]), Parameters: parameters}}
		preview := generationInput{Prompt: text(input.Input["prompt"]), Messages: encode(input.Input["messages"]), Parameters: encode(params)}
		seen := map[string]bool{}
		add := func(id, role string) { key := role+":"+id; if id != "" && !seen[key] { preview.References = append(preview.References, assetInput{AssetID: id, Role: role}); seen[key] = true } }
		for _, role := range []string{"image", "video", "audio"} { for _, item := range array(input.Input[role+"s"]) { add(text(object(item)["assetId"]), role) } }
		var controls []parameterControl; _ = json.Unmarshal(parameters, &controls)
		for _, control := range controls { if control.Type == "asset" && parameterVisible(control, params) { add(text(params[control.Key]), control.Role) } }
		if err := snapshotAssetInputs(a.db, userID, "", preview.References); err != nil { return nil, err }
		if err := a.validateReferenceMedia(snapshot, preview, userID); err != nil { return nil, err }
		arguments, err := a.scriptArguments(GenerationTask{UserID: userID}, snapshot, preview, false); if err != nil { return nil, err }
		for _, key := range []string{"images", "videos", "audios"} { input.Input[key] = arguments[key] }
		if stages["validate"] != "" { valid, err := a.runScript(ctx, snapshot, stages["validate"], input.Input); if err != nil { return nil, problem(400, "script_validation_failed", "样例校验阶段执行失败 / Sample validation failed") }; if valid["valid"] != true { return nil, problem(400, "script_validation_failed", "样例未通过校验 / Invalid sample: "+text(valid["error"])) } }
		for _, key := range []string{"images", "videos", "audios"} { for _, item := range array(input.Input[key]) { asset := object(item); switch asset["transport"] { case "https": asset["url"] = "https://preview.invalid/assets/"+text(asset["assetId"]); case "data": asset["dataUrl"] = "data:"+text(asset["mimeType"])+";base64,PREVIEW" } } }
		request, err := a.runScript(ctx, snapshot, stages["submit"], input.Input); if err != nil { return nil, problem(400, "script_preview_failed", "请求映射失败，请核对脚本与样例输入；签名接口需在真实测试时使用服务端凭据") }
		result["request"], result["placeholderMedia"] = debugResponseMaterial(request), len(preview.References) > 0
		if input.BaseURL != "" { resolved, err := scriptRequestURL(input.BaseURL, text(request["path"])); if err != nil { return nil, problem(400, "invalid_request_path", "预览请求必须使用渠道的 HTTPS 域名 / Preview request must stay on the channel HTTPS origin") }; result["resolvedUrl"] = resolved }
	}
	return result, nil
}
