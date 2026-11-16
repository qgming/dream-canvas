package app

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"strings"

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
	projectFields := map[string]any{"projectId": stringField("明确的目标项目 ID"), "title": stringField("项目名称"), "version": numberField("读取到的项目版本，保存时必须匹配"), "document": map[string]any{"type": "object", "description": "完整画布文档，包含 nodes、connections 及画布设置"}}
	return []toolDefinition{
		{"projects_list", "读取有权限的项目及版本", "read", toolSchema(map[string]any{})},
		{"project_get", "读取指定项目，不能猜测浏览器活动项目", "read", toolSchema(map[string]any{"projectId": stringField("项目 ID")}, "projectId")},
		{"project_create", "创建项目；仅未限制项目的令牌可用", "edit", toolSchema(map[string]any{"title": stringField("项目名称"), "document": map[string]any{"type": "object"}}, "title", "document")},
		{"project_save", "按版本保存节点、连线和设置，冲突时返回错误，不覆盖服务端更新", "edit", toolSchema(projectFields, "projectId", "title", "version", "document")},
		{"assets_list", "读取私人资产元数据；项目范围令牌仅返回范围内项目引用的素材", "read", toolSchema(map[string]any{})},
		{"asset_get", "读取私人资产元数据及保存、同步、删除状态", "read", toolSchema(map[string]any{"assetId": stringField("资产 ID")}, "assetId")},
		{"catalog_list", "读取可用渠道模型目录，不含真实凭据", "read", toolSchema(map[string]any{})},
		{"approval_request", "为项目删除或全局资产删除创建持久确认请求，返回 pending 后等待用户明确确认", "delete", toolSchema(map[string]any{"action": map[string]any{"type": "string", "enum": []string{"delete_project", "delete_asset"}}, "targetId": stringField("目标 ID"), "version": numberField("删除项目时的版本")}, "action", "targetId", "version")},
		{"approvals_list", "读取授权范围内的持久确认状态", "read", toolSchema(map[string]any{})},
		{"approval_decide", "仅在用户明确确认后确认或拒绝删除，禁止自行批准", "delete", toolSchema(map[string]any{"approvalId": stringField("确认请求 ID"), "accept": map[string]any{"type": "boolean", "description": "用户明确确认后才可设为 true"}}, "approvalId", "accept")},
	}
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

func (a *App) CallBusiness(ctx context.Context, p Principal, name string, input map[string]any) (any, error) {
	if err := ctx.Err(); err != nil { return nil, err }
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
	switch name {
	case "projects_list": return a.ListProjects(p.User.ID, p.Projects)
	case "project_get": return a.GetProject(p.User.ID, projectID)
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
		if len(p.Projects) > 0 { query = query.Where("id IN (?)", a.db.Model(&AssetReference{}).Select("asset_id").Where("project_id IN ?", p.Projects)) }
		err := query.Order("created_at DESC").Find(&assets).Error
		return assets, err
	case "asset_get":
		if err := a.checkTokenAsset(p, text("assetId")); err != nil { return nil, err }
		var asset Asset
		err := a.db.First(&asset, "id = ? AND user_id = ?", text("assetId"), p.User.ID).Error
		return asset, err
	case "catalog_list":
		return a.ModelCatalog()
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
	if action == "delete_project" && (len(p.Projects) == 0 || includes(p.Projects, target)) { return nil }
	if action == "delete_asset" && len(p.Projects) == 0 { return nil }
	return problem(403, "delete_scope", "全局资产删除需要不限项目的令牌；项目删除需要目标项目授权")
}
