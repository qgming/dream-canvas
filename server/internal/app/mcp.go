package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"math"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"gorm.io/gorm"
)

type toolDefinition struct { Name, Description, Scope string; Schema map[string]any }
func toolSchema(properties map[string]any, required ...string) map[string]any {
	schema := map[string]any{"type": "object", "properties": properties, "additionalProperties": false}
	if len(required) > 0 { schema["required"] = required }
	return schema
}
func stringField(description string) map[string]any { return map[string]any{"type": "string", "description": description} }
func numberField(description string) map[string]any { return map[string]any{"type": "integer", "minimum": 0, "maximum": 9007199254740991, "description": description} }

func businessTools() []toolDefinition {
	projectFields := map[string]any{"projectId": stringField("明确的目标项目 ID"), "title": stringField("项目名称"), "version": numberField("本次修改基于的读取版本"), "document": map[string]any{"type": "object", "description": "完整画布文档，包含 nodes、connections 及画布设置"}}
	return append([]toolDefinition{
		{"clients_list", "列出当前用户授权项目的在线画布客户端，不猜测活动页面", "read", toolSchema(map[string]any{})},
		{"client_get", "读取明确在线客户端的选区、节点编号、视口与状态版本", "read", toolSchema(map[string]any{"clientId": stringField("明确客户端 ID")}, "clientId")},
		{"client_select", "对明确客户端设置选区；返回 pending 后查询状态，不代表已应用", "edit", toolSchema(map[string]any{"clientId": stringField("客户端 ID"), "revision": numberField("读取的客户端版本"), "nodeIds": map[string]any{"type": "array", "items": stringField("节点 ID")}}, "clientId", "revision", "nodeIds")},
		{"client_viewport", "设置明确客户端视口，不修改服务端业务内容", "edit", toolSchema(map[string]any{"clientId": stringField("客户端 ID"), "revision": numberField("读取的客户端版本"), "viewport": map[string]any{"type": "object", "properties": map[string]any{"x": map[string]any{"type": "number"}, "y": map[string]any{"type": "number"}, "k": map[string]any{"type": "number", "exclusiveMinimum": 0}}, "required": []string{"x", "y", "k"}, "additionalProperties": false}}, "clientId", "revision", "viewport")},
		{"client_navigate", "将明确客户端导航到授权项目，页面仍执行未保存编辑保护", "edit", toolSchema(map[string]any{"clientId": stringField("客户端 ID"), "revision": numberField("读取的客户端版本"), "projectId": stringField("明确目标项目")}, "clientId", "revision", "projectId")},
		{"client_command_get", "查询页面操作的 pending、applied、rejected 或 interrupted 结果", "read", toolSchema(map[string]any{"commandId": stringField("操作 ID")}, "commandId")},
		{"projects_list", "读取有权限的项目及版本", "read", toolSchema(map[string]any{})},
		{"project_get", "读取指定项目，不能猜测浏览器活动项目", "read", toolSchema(map[string]any{"projectId": stringField("项目 ID")}, "projectId")},
		{"project_history", "读取项目统一撤销和重做历史；人工、助手、MCP 与生成结果使用相同历史", "read", toolSchema(map[string]any{"projectId": stringField("项目 ID")}, "projectId")},
		{"project_revert", "按当前版本撤销或重做历史栈顶部的一次修改，作为新版本自动保存；不删除资产或取消已提交生成", "edit", toolSchema(map[string]any{"projectId": stringField("项目 ID"), "version": numberField("当前项目版本"), "targetVersion": numberField("project_history 的 past 或 future 栈顶版本")}, "projectId", "version", "targetVersion")},
		{"project_create", "创建项目；仅未限制项目的令牌可用", "edit", toolSchema(map[string]any{"title": stringField("项目名称"), "document": map[string]any{"type": "object"}}, "title", "document")},
		{"project_save", "提交相对读取版本的节点、连线和设置修改；服务端合并无关并发修改，同字段按提交顺序保存，目标已删除或结构冲突时保留服务端内容并报错", "edit", toolSchema(projectFields, "projectId", "title", "version", "document")},
		{"assets_list", "读取私人资产库元数据；工作台文件须手动保存才进入资产库，项目范围令牌仅返回范围内项目引用的素材", "read", toolSchema(map[string]any{})},
		{"asset_get", "读取私人资产元数据及保存、同步、删除状态", "read", toolSchema(map[string]any{"assetId": stringField("资产 ID")}, "assetId")},
		{"asset_content", "读取私人媒体原件；返回 base64，遵循管理员 JSON 大小边界，大文件应使用带 Bearer 的 HTTP 文件接口", "read", toolSchema(map[string]any{"assetId": stringField("资产 ID")}, "assetId")},
		{"asset_update", "修改资产名称与说明，并将工作台文件保留到资产库，不改变原件", "edit", toolSchema(map[string]any{"assetId": stringField("资产 ID"), "title": stringField("名称"), "metadata": map[string]any{"type": "object"}}, "assetId", "title", "metadata")},
		{"asset_text_create", "在用户资产库保存文本资产，项目范围令牌不允许创建全局资产", "edit", toolSchema(map[string]any{"title": stringField("名称"), "metadata": map[string]any{"type": "object", "description": "content 文本正文、note 备注、source 来源、coverUrl 封面地址"}}, "title", "metadata")},
		{"asset_sync", "重新排队同步已有资产，保留其原存储归属", "edit", toolSchema(map[string]any{"assetId": stringField("资产 ID")}, "assetId")},
		{"asset_voices", "读取音频资产在各渠道已注册的音色编号", "read", toolSchema(map[string]any{"assetId": stringField("音频资产 ID")}, "assetId")},
		{"asset_voice_save", "关联已注册音色编号；不会调用供应商克隆或注册音色", "edit", toolSchema(map[string]any{"assetId": stringField("音频资产 ID"), "channelId": stringField("渠道 ID"), "voiceId": stringField("已注册编号"), "version": numberField("现有版本，新建为 0")}, "assetId", "channelId", "voiceId", "version")},
		{"catalog_list", "读取按管理员排序返回的可用渠道模型目录；parameters 包含管理员及脚本默认值，pricing 只返回积分投影，不含真实凭据或成本", "read", toolSchema(map[string]any{})},
		{"prompts_search", "按文本、图片或视频类型搜索项目内置及当前用户的提示词", "read", toolSchema(map[string]any{"keyword": stringField("关键词"), "scope": map[string]any{"type": "string", "enum": []string{"all", "builtin", "user"}}, "type": map[string]any{"type": "string", "enum": []string{"all", "text", "image", "video"}}, "locale": stringField("可选 zh-CN 或 en-US")})},
		{"prompt_get", "读取内置或当前用户的提示词及版本", "read", toolSchema(map[string]any{"promptId": stringField("提示词 ID"), "locale": stringField("可选 zh-CN 或 en-US")}, "promptId")},
		{"prompt_save", "创建或按版本保存我的提示词；内置提示词只读，需要不限项目的授权", "edit", toolSchema(map[string]any{"promptId": stringField("修改时填写，新建留空"), "version": numberField("读取版本，新建为 0"), "title": stringField("名称"), "prompt": stringField("提示词正文"), "type": map[string]any{"type": "string", "enum": []string{"text", "image", "video"}}, "description": stringField("说明"), "category": stringField("分类")}, "version", "title", "prompt", "type")},
		{"prompt_delete", "按读取版本删除我的提示词；内置提示词只读，需要不限项目的授权", "edit", toolSchema(map[string]any{"promptId": stringField("提示词 ID"), "version": numberField("读取版本")}, "promptId", "version")},
		{"workbench_records", "读取图片或视频工作台展示记录，与生成任务分开管理", "read", toolSchema(map[string]any{"kind": map[string]any{"type": "string", "enum": []string{"image", "video"}}}, "kind")},
		{"workbench_record_save", "按版本保存工作台展示记录，不提交生成或记账", "edit", toolSchema(map[string]any{"kind": map[string]any{"type": "string", "enum": []string{"image", "video"}}, "recordId": stringField("记录 ID"), "version": numberField("读取的版本，新建为 0"), "value": map[string]any{"type": "object"}}, "kind", "recordId", "version", "value")},
		{"workbench_record_remove", "按版本删除生成记录并清理未手动保留的专属文件；保留资产库、其他记录及项目引用和历史用量，在途任务继续执行，文件清理可能待处理", "edit", toolSchema(map[string]any{"kind": map[string]any{"type": "string", "enum": []string{"image", "video"}}, "recordId": stringField("记录 ID"), "version": numberField("读取到的记录版本")}, "kind", "recordId", "version")},
		{"skills_list", "读取个人及当前角色可用的内置 Skill 列表", "read", toolSchema(map[string]any{"locale": stringField("可选 zh-CN 或 en-US")})},
		{"skill_get", "读取个人或当前角色可用的内置 Skill 指令与版本", "read", toolSchema(map[string]any{"name": stringField("Skill 标识"), "locale": stringField("可选 zh-CN 或 en-US")}, "name")},
		{"skill_save", "创建或按版本修改个人 Skill；不执行模型调用", "edit", toolSchema(map[string]any{"name": stringField("Skill 标识"), "description": stringField("说明"), "instructions": stringField("指令"), "interface": map[string]any{"type": "object"}, "expectedRevision": stringField("读取的版本，新建时留空"), "enabled": map[string]any{"type": "boolean"}}, "name")},
		{"skill_delete", "按读取版本删除个人 Skill，不删除对话或项目", "edit", toolSchema(map[string]any{"name": stringField("Skill 标识"), "expectedRevision": stringField("读取的版本")}, "name", "expectedRevision")},
		{"generation_create", "按明确渠道和模型提交持久生成任务；项目任务需要项目版本和已保存目标节点，独立工作台任务可指定记录归属并手动保留成品", "generate", toolSchema(map[string]any{"channelId": stringField("渠道 ID"), "modelId": stringField("模型 ID"), "capability": map[string]any{"type": "string", "enum": []string{"text", "image", "video", "audio"}}, "projectId": stringField("明确目标项目 ID"), "workbenchRecordId": stringField("可选图片或视频工作台记录 ID，与 projectId 互斥；成品仅手动保存后进入资产库"), "nodeId": stringField("目标节点 ID"), "projectVersion": numberField("读取到的项目版本"), "prompt": stringField("提示词"), "parameters": map[string]any{"type": "object"}, "references": map[string]any{"type": "array", "items": map[string]any{"type": "object", "properties": map[string]any{"assetId": stringField("资产 ID"), "role": map[string]any{"type": "string", "enum": []string{"image", "video", "audio"}}}, "required": []string{"assetId", "role"}, "additionalProperties": false}}}, "channelId", "modelId", "capability", "prompt", "parameters")},
		{"generation_quote", "按明确渠道、模型和有效参数预估积分，不调用供应商；未知单位或 token 用量返回 unknown 和 null，不猜测为 0", "generate", toolSchema(map[string]any{"channelId": stringField("渠道 ID"), "modelId": stringField("模型 ID"), "parameters": map[string]any{"type": "object", "description": "与生成提交相同的模型参数；省略字段采用管理员及脚本默认值"}, "prompt": stringField("可选提示词，用于字符数计价"), "messages": map[string]any{"type": "array", "items": map[string]any{"type": "object"}, "description": "可选消息数组，用于字符数计价"}, "requests": map[string]any{"type": "integer", "minimum": 1, "description": "可选请求次数，默认 1"}}, "channelId", "modelId", "parameters")},
		{"tasks_wait", "读取明确任务是否均已结束或需人工核对；ready=false 返回待等待任务。云端助手会持久等待并让出执行名额，完成后自动续行；外部 MCP 返回同一状态快照，不阻塞 HTTP，也不重新生成", "read", toolSchema(map[string]any{"taskIds": map[string]any{"type": "array", "minItems": 1, "uniqueItems": true, "items": stringField("明确生成任务 ID")}}, "taskIds")},
		{"tasks_list", "读取授权项目内的生成任务和保存、同步状态", "read", toolSchema(map[string]any{})},
		{"task_get", "读取生成任务、成品资产及待确认状态", "read", toolSchema(map[string]any{"taskId": stringField("任务 ID")}, "taskId")},
		{"task_cancel", "取消未提交任务，已提交任务记录取消意愿并继续核对实际结果", "generate", toolSchema(map[string]any{"taskId": stringField("任务 ID")}, "taskId")},
		{"task_resume", "仅继续查询已有上游编号或保存已收到结果，不重新提交供应商", "generate", toolSchema(map[string]any{"taskId": stringField("任务 ID")}, "taskId")},
		{"usage_list", "读取授权项目内的积分用量及汇总，可按开始执行时间和渠道模型筛选；未知积分单独计入 pendingCount，不暴露成本", "read", toolSchema(map[string]any{"userId": stringField("用户 ID"), "projectId": stringField("项目 ID"), "channelId": stringField("渠道 ID"), "modelId": stringField("模型 ID"), "capability": stringField("能力"), "from": stringField("含时区的起始时间"), "to": stringField("含时区的结束时间")})},
		{"approval_request", "为项目删除或全局资产删除创建持久确认请求，返回 pending 后等待用户明确确认", "delete", toolSchema(map[string]any{"action": map[string]any{"type": "string", "enum": []string{"delete_project", "delete_asset"}}, "targetId": stringField("目标 ID"), "version": numberField("删除项目时的版本")}, "action", "targetId", "version")},
		{"approvals_list", "读取授权范围内的持久确认状态", "read", toolSchema(map[string]any{})},
		{"approval_decide", "仅在用户明确确认后确认或拒绝删除，禁止自行批准", "delete", toolSchema(map[string]any{"approvalId": stringField("确认请求 ID"), "accept": map[string]any{"type": "boolean", "description": "用户明确确认后才可设为 true"}}, "approvalId", "accept")},
	}, append(canvasTools(), managementTools()...)...)
}

func (a *App) mcpHandler() http.Handler {
	return mcp.NewStreamableHTTPHandler(func(r *http.Request) *mcp.Server {
		raw := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		principal, err := a.tokenPrincipal(raw)
		if err != nil { return nil }
		server := mcp.NewServer(&mcp.Implementation{Name: "dream-canvas", Version: "0.1.0"}, nil)
		for _, tool := range businessTools() {
			if !principal.allows(tool.Scope, "") { continue }
			mcp.AddTool(server, &mcp.Tool{Name: tool.Name, Description: tool.Description, InputSchema: tool.Schema}, func(ctx context.Context, request *mcp.CallToolRequest, input map[string]any) (*mcp.CallToolResult, any, error) {
				current, err := a.tokenPrincipal(raw)
				if err != nil { return toolResult(nil, err), nil, nil }
				value, err := a.CallBusiness(ctx, current, tool.Name, input)
				return toolResult(value, err), nil, nil
			})
		}
		return server
	}, &mcp.StreamableHTTPOptions{Stateless: true, JSONResponse: true})
}

func toolResult(value any, err error) *mcp.CallToolResult {
	if err != nil {
		message := "操作失败，请重试"
		var p *Problem
		if errors.As(err, &p) { message = p.Message } else if errors.Is(err, gorm.ErrRecordNotFound) { message = "内容不存在或无权访问" }
		return &mcp.CallToolResult{IsError: true, Content: []mcp.Content{&mcp.TextContent{Text: message}}}
	}
	encoded, marshalErr := json.Marshal(value)
	if marshalErr != nil { return &mcp.CallToolResult{IsError: true, Content: []mcp.Content{&mcp.TextContent{Text: "工具结果无法编码"}}} }
	return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: string(encoded)}}}
}

func (a *App) CallBusiness(ctx context.Context, p Principal, name string, input map[string]any) (output any, failure error) {
	started := time.Now()
	defer func() {
		if !a.logEnabled(slog.LevelInfo) { return }
		known := false; for _, tool := range businessTools() { if tool.Name == name { known = true; break } }
		fields := []slog.Attr{slog.String("user_id", p.User.ID), slog.Bool("assistant", p.FixedProject), slog.Int64("duration_ms", time.Since(started).Milliseconds())}
		if known { fields = append(fields, slog.String("tool", name)) }
		if failure != nil { a.logFailure(ctx, "business.tool_failed", failure, fields...) } else { a.logEvent(ctx, slog.LevelDebug, "business.tool_completed", fields...) }
	}()
	if err := ctx.Err(); err != nil { return nil, err }
	if err := a.db.First(&p.User, "id = ? AND disabled = ?", p.User.ID, false).Error; err != nil { return nil, problem(403, "account_disabled", "账号已停用或不存在") }
	text := func(key string) string { value, _ := input[key].(string); return value }
	version := uint64(0)
	if raw, exists := input["version"]; exists {
		value, ok := raw.(float64)
		if !ok || math.IsNaN(value) || math.IsInf(value, 0) || value < 0 || value > 9007199254740991 || math.Trunc(value) != value { return nil, problem(400, "invalid_version", "版本需要可精确表示的非负整数") }
		version = uint64(value)
	}
	projectID := text("projectId")
	scope := ""
	for _, tool := range businessTools() { if tool.Name == name { scope = tool.Scope; break } }
	if scope == "" || !p.allows(scope, projectID) { return nil, problem(403, "forbidden", "令牌不允许此操作或项目") }
	if p.FixedProject {
		if !assistantToolAllowed(name) { return nil, problem(403, "direct_user_action", "此操作需用户主动完成，助手不能代为确认、处理凭据或启动另一个助手执行") }
		if includes([]string{"admin_channel_save", "admin_storage_save"}, name) { for _, key := range []string{"credential", "accessKeyId", "accessKeySecret"} { if _, exists := object(input["config"])[key]; exists { return nil, problem(403, "credential_user_input", "凭据只能由管理员在配置页主动输入，助手可修改其他配置字段") } } }
	}
	if value, handled, err := a.callManagement(ctx, p, name, input); handled { return value, err }
	if p.FixedProject && name == "project_create" && p.TargetProjectID != "" { return nil, problem(409, "target_project_fixed", "本轮已固定目标项目，创建其他项目请开启下一轮") }
	if p.FixedProject && includes([]string{"project_get", "project_save", "project_history", "project_revert", "canvas_apply_ops"}, name) && (projectID == "" || projectID != p.TargetProjectID) { return nil, problem(409, "target_project_required", "请操作本轮明确的目标项目；未选择项目时可先创建一个项目") }
	if p.FixedProject && name == "generation_create" && projectID != p.TargetProjectID { return nil, problem(409, "target_project_fixed", "生成任务需要本轮明确的目标项目；无目标项目时可提交独立生成") }
	switch name {
	case "canvas_apply_ops": return a.ApplyCanvasOperations(p, input)
	case "clients_list", "client_get", "client_select", "client_viewport", "client_navigate", "client_command_get": return a.clientBusiness(p, name, input)
	case "projects_list": return a.ListProjects(p.User.ID, p.Projects)
	case "project_get": return a.GetProject(p.User.ID, projectID)
	case "project_history":
		project, err := a.GetProject(p.User.ID, projectID); if err != nil { return nil, err }; return a.ProjectHistory(project)
	case "project_revert":
		target, ok := input["targetVersion"].(float64); if !ok || math.IsNaN(target) || math.IsInf(target, 0) || target < 1 || target > 9007199254740991 || math.Trunc(target) != target { return nil, problem(400, "invalid_version", "请提供历史栈顶部的有效版本") }
		if _, err := a.GetProject(p.User.ID, projectID); err != nil { return nil, err }
		var revision ProjectRevision; if err := a.db.First(&revision, "project_id = ? AND version = ?", projectID, uint64(target)-1).Error; err != nil { return nil, err }
		var operation ProjectRevision; if err := a.db.First(&operation, "project_id = ? AND version = ?", projectID, uint64(target)).Error; err != nil { return nil, err }
		if operation.OperationID != "" { revision = ProjectRevision{}; if err := a.db.Where("project_id = ? AND version < ? AND (operation_id <> ? OR reverts_version <> 0)", projectID, uint64(target), operation.OperationID).Order("version DESC").First(&revision).Error; err != nil { return nil, err } }
		refs, err := validateDocument(revision.Document); if err != nil { return nil, err }; for _, id := range refs { if err := a.checkTokenAsset(p, id); err != nil { return nil, err } }
		return a.RevertProject(p.User.ID, projectID, version, uint64(target))
	case "project_create":
		if len(p.Projects) > 0 { return nil, problem(403, "project_scope", "限定项目的令牌不能创建其他项目") }
		document, err := json.Marshal(input["document"])
		if err != nil { return nil, err }
		return a.CreateProject(p.User.ID, projectInput{Title: text("title"), Document: document})
	case "project_save":
		document, err := json.Marshal(input["document"])
		if err != nil { return nil, err }
		refs, err := validateDocument(document)
		if err != nil { return nil, err }
		for _, id := range refs { if err := a.checkTokenAsset(p, id); err != nil { return nil, err } }
		return a.SaveProject(p.User.ID, projectID, projectInput{Title: text("title"), Version: version, Document: document})
	case "assets_list":
		assets := []Asset{}
		query := a.db.Where("user_id = ? AND delete_state = ?", p.User.ID, "")
		if len(p.Projects) > 0 { query = query.Where("id IN (?)", a.db.Model(&AssetReference{}).Select("asset_id").Where("project_id IN ?", p.Projects)) } else { query = query.Where("workbench_record_id = ?", "") }
		err := query.Order("created_at DESC").Find(&assets).Error
		return assets, err
	case "asset_get":
		if err := a.checkTokenAsset(p, text("assetId")); err != nil { return nil, err }
		var asset Asset
		err := a.db.First(&asset, "id = ? AND user_id = ?", text("assetId"), p.User.ID).Error
		return asset, err
	case "asset_content", "asset_voices", "asset_voice_save", "asset_sync", "asset_update":
		id := text("assetId")
		if err := a.checkTokenAsset(p, id); err != nil { return nil, err }
		var asset Asset; if err := a.db.First(&asset, "id = ? AND user_id = ? AND delete_state = ?", id, p.User.ID, "").Error; err != nil { return nil, err }
		switch name {
		case "asset_update":
			metadata := encode(input["metadata"]); refs, err := collectAssetReferences(input["metadata"]); if err != nil { return nil, err }; for _, ref := range refs { if err := a.checkTokenAsset(p, ref); err != nil { return nil, err } }
			err = a.UpdateAsset(p.User.ID, id, text("title"), metadata); return map[string]any{"saved": err == nil}, err
		case "asset_voices": rows := []AssetVoice{}; err := a.db.Where("asset_id = ? AND user_id = ?", id, p.User.ID).Find(&rows).Error; return rows, err
		case "asset_voice_save": return a.SaveAssetVoice(p.User.ID, id, text("channelId"), text("voiceId"), version)
		case "asset_sync":
			if asset.SaveState != "saved" { return nil, problem(409, "asset_not_saved", "原件尚未可靠保存") }
			if err := a.queueAssetSync(id); err != nil { return nil, err }; if err := a.db.Model(&FileOperation{}).Where("asset_id = ? AND kind = ?", id, "sync").Update("next_run_at", nil).Error; err != nil { return nil, err }; a.signalWork(); return map[string]any{"queued": true}, nil
		case "asset_content":
			policy, err := a.executionPolicy(); if err != nil { return nil, err }
			if asset.Kind == "text" { return assetMetadata(asset.Metadata) }
			if asset.SaveState != "saved" || asset.Bytes < 0 || asset.Bytes > (policy.JSONBytes/4)*3 { return nil, problem(413, "content_too_large", "原件尚未保存或超过工具 JSON 边界，请使用带 Bearer 的 HTTP 文件接口") }
			release, err := a.acquireFile(ctx, false, false); if err != nil { return nil, err }; defer release(); a.assetFiles.RLock(); defer a.assetFiles.RUnlock()
			if err := a.db.First(&asset, "id = ? AND delete_state = ?", id, "").Error; err != nil { return nil, err }; path, err := a.assetPath(id); if err != nil { return nil, err }; file, err := os.Open(path); if err != nil { return nil, err }; defer file.Close()
			data, err := io.ReadAll(io.LimitReader(file, policy.JSONBytes+1)); if err != nil { return nil, err }; if int64(base64.StdEncoding.EncodedLen(len(data))) > policy.JSONBytes { return nil, problem(413, "content_too_large", "媒体超过工具 JSON 边界") }; return map[string]any{"mimeType": asset.MimeType, "base64": base64.StdEncoding.EncodeToString(data)}, nil
		}
	case "asset_text_create":
		if len(p.Projects) > 0 { return nil, problem(403, "asset_scope", "创建全局资产需要不限项目的授权") }
		return a.CreateTextAsset(p.User.ID, text("title"), encode(input["metadata"]))
	case "prompts_search":
		if scope := text("scope"); scope != "" && !includes([]string{"all", "builtin", "user"}, scope) { return nil, problem(400, "invalid_prompt_scope", "请选择内置提示词或我的提示词") }
		if promptType := text("type"); promptType != "" && !includes([]string{"all", "text", "image", "video"}, promptType) { return nil, problem(400, "invalid_prompt_type", "请选择文本、图片或视频提示词") }
		rows, err := a.ListPrompts(ctx, p.User.ID, text("locale")); if err != nil { return nil, err }; result := []Prompt{}; keyword := strings.ToLower(strings.TrimSpace(text("keyword")))
		for _, row := range rows { if text("scope") == "builtin" && !row.BuiltIn || text("scope") == "user" && row.BuiltIn { continue }; if text("type") != "" && text("type") != "all" && row.Type != text("type") { continue }; if keyword == "" || strings.Contains(strings.ToLower(strings.Join([]string{row.Title, row.Description, row.Prompt, row.Category}, " ")), keyword) { result = append(result, row) } }; return result, nil
	case "prompt_get":
		return a.GetPrompt(ctx, p.User.ID, text("promptId"), text("locale"))
	case "prompt_save", "prompt_delete":
		if len(p.Projects) > 0 { return nil, problem(403, "prompt_scope", "修改个人提示词需要不限项目的授权") }
		if name == "prompt_delete" { err := a.DeletePrompt(p.User.ID, text("promptId"), version); return map[string]any{"deleted": err == nil}, err }
		var request promptInput; if err := json.Unmarshal(encode(input), &request); err != nil { return nil, err }; return a.SavePrompt(p.User.ID, text("promptId"), request, text("promptId") == "")
	case "workbench_records", "workbench_record_save", "workbench_record_remove":
		if len(p.Projects) > 0 { return nil, problem(403, "workbench_scope", "全局工作台记录需要不限项目的授权") }
		kind := text("kind"); if !includes([]string{"image", "video"}, kind) { return nil, problem(400, "invalid_workbench", "请选择图片或视频工作台") }
		if name == "workbench_record_save" { return a.SaveWorkbenchRecord(p.User.ID, kind, text("recordId"), version, encode(input["value"])) }
		if name == "workbench_record_remove" { pending, err := a.DeleteWorkbenchRecord(p.User.ID, kind, text("recordId"), version); return map[string]any{"removed": err == nil, "cleanupPending": pending}, err }
		rows := []WorkbenchRecord{}; err := a.db.Where("user_id = ? AND kind = ? AND removed = ?", p.User.ID, kind, false).Order("created_at DESC").Find(&rows).Error; return rows, err
	case "skills_list":
		user := p.User; if !p.allows("admin", "") { user.Role = "user" }; return a.ListAssistantSkills(user, text("locale"))
	case "skill_get":
		user := p.User; if !p.allows("admin", "") { user.Role = "user" }; return a.GetAssistantSkill(user, text("name"), text("locale"))
	case "skill_save", "skill_delete":
		if len(p.Projects) > 0 { return nil, problem(403, "skill_scope", "修改全局个人 Skill 需要不限项目的授权") }
		if name == "skill_delete" { err := a.DeleteAssistantSkill(p.User.ID, text("name"), text("expectedRevision")); return map[string]any{"deleted": err == nil}, err }
		var request skillInput; if err := json.Unmarshal(encode(input), &request); err != nil { return nil, err }; row, err := a.SaveAssistantSkill(p.User.ID, request.Name, request, request.ExpectedRevision == ""); return skillView(row, true), err
	case "catalog_list":
		return a.ModelCatalog()
	case "generation_create":
		var request generationInput
		if err := json.Unmarshal(encode(input), &request); err != nil { return nil, err }
		if len(p.Projects) > 0 && !includes(p.Projects, request.ProjectID) { return nil, problem(403, "project_scope", "任务需要令牌范围内的明确目标项目") }
		for _, reference := range request.References { if err := a.checkTokenAsset(p, reference.AssetID); err != nil { return nil, err } }
		return a.CreateTask(p.User.ID, request)
	case "generation_quote":
		var request generationQuoteInput
		if err := json.Unmarshal(encode(input), &request); err != nil { return nil, problem(400, "invalid_input", "积分预估参数不正确") }
		return a.GenerationQuote(p, request)
	case "tasks_list":
		tasks := []GenerationTask{}
		query := a.db.Where("user_id = ?", p.User.ID)
		if len(p.Projects) > 0 { query = query.Where("project_id IN ?", p.Projects) }
		err := query.Order("created_at DESC").Find(&tasks).Error; return tasks, err
	case "tasks_wait":
		var request struct { IDs []string `json:"taskIds"` }; if json.Unmarshal(encode(input), &request) != nil { return nil, problem(400, "invalid_tasks", "请提供要等待的任务编号") }
		return a.WaitTasks(p, request.IDs)
	case "task_get", "task_cancel", "task_resume":
		var task GenerationTask
		if err := a.db.First(&task, "id = ? AND user_id = ?", text("taskId"), p.User.ID).Error; err != nil { return nil, err }
		if !p.allows(scope, task.ProjectID) { return nil, problem(403, "project_scope", "任务不在令牌项目或本轮目标范围内") }
		if name == "task_cancel" { return a.CancelTask(p.User.ID, task.ID) }; if name == "task_resume" { return a.ResumeTask(p.User.ID, task.ID) }; return task, nil
	case "usage_list":
		filters := map[string]string{}; for _, key := range []string{"userId", "projectId", "channelId", "modelId", "capability", "from", "to"} { filters[key] = text(key) }; return a.ListUsage(p.User.ID, p.Projects, filters)
	case "approval_request":
		if err := a.checkTokenDeletion(p, text("action"), text("targetId")); err != nil { return nil, err }
		return a.RequestApproval(p.User.ID, text("action"), text("targetId"), version)
	case "approvals_list":
		approvals, err := a.ListApprovals(p.User.ID)
		if err != nil { return nil, err }
		result := []Approval{}
		for _, approval := range approvals { if a.checkTokenDeletion(p, approval.Action, approval.TargetID) == nil { result = append(result, approval) } }
		return result, nil
	case "approval_decide":
		var approval Approval
		if err := a.db.First(&approval, "id = ? AND user_id = ?", text("approvalId"), p.User.ID).Error; err != nil { return nil, err }
		if err := a.checkTokenDeletion(p, approval.Action, approval.TargetID); err != nil { return nil, err }
		accept, _ := input["accept"].(bool)
		return a.DecideApproval(p.User.ID, approval.ID, accept)
	}
	return nil, problem(404, "unknown_tool", "不支持的业务工具")
}

func (a *App) checkTokenAsset(p Principal, id string) error {
	if len(p.Projects) == 0 { return nil }
	var count int64
	if err := a.db.Model(&AssetReference{}).Where("asset_id = ? AND project_id IN ?", id, p.Projects).Count(&count).Error; err != nil { return err }
	if count == 0 { return problem(403, "asset_scope", "资产不在令牌授权的项目范围内") }
	return nil
}

func (a *App) checkTokenDeletion(p Principal, action, target string) error {
	if p.FixedProject && action == "delete_project" && (p.TargetProjectID == "" || target != p.TargetProjectID) { return problem(403, "target_project_fixed", "项目删除需要本轮明确的目标项目") }
	if action == "delete_project" && (len(p.Projects) == 0 || includes(p.Projects, target)) { return nil }
	if action == "delete_asset" && len(p.Projects) == 0 { return nil }
	return problem(403, "delete_scope", "全局资产删除需要不限项目的令牌；项目删除需要目标项目授权")
}
