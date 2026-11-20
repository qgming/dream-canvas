package app

import (
	"context"
	"encoding/json"
	"strings"
)

func managementTools() []toolDefinition {
	objectField := func(description string) map[string]any { return map[string]any{"type": "object", "description": description} }
	tool := func(name, description, scope string, fields map[string]any, required ...string) toolDefinition { return toolDefinition{name, description, scope, toolSchema(fields, required...)} }
	return []toolDefinition{
		tool("preference_get", "读取个人创作偏好；需要不限项目的授权", "read", map[string]any{"name": stringField("generation")}, "name"),
		tool("preference_save", "按版本保存个人画布交互偏好；生成参数使用模型接口插件定义，需要不限项目的授权", "edit", map[string]any{"name": stringField("generation"), "version": numberField("读取版本，新建为 0"), "value": objectField("完整配置对象；仅支持 nodeRegenerateBehavior/autoFocusOnSelect")}, "name", "version", "value"),
		tool("asset_cleanup", "继续已确认的全局资产删除，不创建新的删除意愿", "edit", map[string]any{"assetId": stringField("待删除资产 ID")}, "assetId"),
		tool("assistant_threads_list", "读取全局助手对话列表，需要单独的助手权限", "assistant", map[string]any{}),
		tool("assistant_thread_get", "读取全局对话、轮次、消息与待确认项", "assistant", map[string]any{"threadId": stringField("对话 ID")}, "threadId"),
		tool("assistant_thread_create", "创建全局助手对话，不调用模型", "assistant", map[string]any{"title": stringField("对话标题")}),
		tool("assistant_thread_delete", "删除已停止且用量已保存的对话，历史用量账本保留", "assistant", map[string]any{"threadId": stringField("对话 ID")}, "threadId"),
		tool("assistant_turn_start", "主动提交助手轮次，可能产生模型和生成费用；项目明确绑定，页面操作可绑定在线客户端", "assistant", map[string]any{"threadId": stringField("对话 ID"), "version": numberField("读取到的对话版本"), "prompt": stringField("用户消息"), "projectId": stringField("目标项目 ID，无项目留空"), "clientId": stringField("可选明确在线客户端 ID"), "channelId": stringField("文本渠道 ID"), "modelId": stringField("文本模型配置 ID"), "parameters": objectField("本轮声明参数；命名素材传原始资产 ID，省略采用管理员模型默认值及脚本默认值"), "skill": stringField("可选 Skill 名称"), "attachments": map[string]any{"type": "array", "items": stringField("图片资产 ID")}, "references": map[string]any{"type": "array", "items": stringField("已保存节点 ID")}}, "threadId", "version", "prompt", "channelId", "modelId"),
		tool("assistant_turn_cancel", "停止助手轮次，已提交生成任务由任务入口单独取消", "assistant", map[string]any{"turnId": stringField("轮次 ID")}, "turnId"),
		tool("assistant_skill_draft_create", "按明确画布或对话材料提交 Skill 草稿任务，可能产生文本模型费用，不自动保存为启用 Skill", "assistant", map[string]any{"source": map[string]any{"type": "string", "enum": []string{"canvas", "conversation"}}, "projectId": stringField("画布材料的项目 ID"), "threadId": stringField("对话材料的对话 ID"), "model": stringField("明确的渠道 ID::模型 ID"), "parameters": objectField("所选文本模型的声明参数，命名素材为资产 ID；省略采用管理员模型默认值及脚本默认值")}, "source", "model"),
		tool("assistant_skill_draft_get", "读取 Skill 草稿任务状态与结果", "assistant", map[string]any{"turnId": stringField("草稿轮次 ID")}, "turnId"),
		tool("tokens_list", "读取自己的令牌记录，不返回令牌明文", "account", map[string]any{}),
		tool("token_create", "创建令牌，权限不能超出调用令牌；明文只返回本次", "account", map[string]any{"name": stringField("名称"), "scopes": map[string]any{"type": "array", "items": stringField("read/edit/generate/delete/assistant/account/admin")}, "projects": map[string]any{"type": "array", "items": stringField("项目 ID，空数组表示不限项目")}}, "name", "scopes", "projects"),
		tool("token_revoke", "撤销自己的访问令牌，包括当前令牌", "account", map[string]any{"tokenId": stringField("令牌记录 ID")}, "tokenId"),
		tool("password_change", "核对当前密码后修改自己的密码并撤销网页会话，不返回密码", "account", map[string]any{"currentPassword": stringField("当前密码"), "password": stringField("新密码")}, "currentPassword", "password"),
		tool("admin_users_list", "管理员读取账号列表，不含密码", "admin", map[string]any{}),
		tool("admin_canvas_plugins_list", "读取全站节点插件及启停、发布状态", "admin", map[string]any{}),
		tool("admin_canvas_plugin_contract", "编写节点插件前先读取包、SDK、运行边界与发布约定", "admin", map[string]any{"locale": stringField("可选 zh-CN 或 en-US")}),
		tool("admin_canvas_plugin_get", "读取节点插件、完整草稿及不可变发布版本；内置插件只读", "admin", map[string]any{"pluginId": stringField("插件 ID")}, "pluginId"),
		tool("admin_canvas_plugin_create", "创建自建节点插件草稿，默认停用", "admin", map[string]any{"name": stringField("名称"), "description": stringField("说明")}, "name"),
		tool("admin_canvas_plugin_draft_save", "按草稿版本保存完整节点插件 files 映射；不发布、不影响使用者，先读取契约与当前草稿", "admin", map[string]any{"pluginId": stringField("插件 ID"), "revision": numberField("草稿版本"), "files": map[string]any{"type": "object", "additionalProperties": map[string]any{"type": "string"}}}, "pluginId", "revision", "files"),
		tool("admin_canvas_plugin_publish", "仅由管理员主动确认后编译发布节点插件，代码将在使用者浏览器中执行", "admin", map[string]any{"pluginId": stringField("插件 ID"), "revision": numberField("草稿版本"), "version": numberField("插件记录版本"), "confirmed": map[string]any{"type": "boolean"}}, "pluginId", "revision", "version", "confirmed"),
		tool("admin_canvas_plugin_enabled", "仅由管理员主动确认后按版本调整全站节点插件启停，已有节点内容保留", "admin", map[string]any{"pluginId": stringField("插件 ID"), "version": numberField("插件记录版本"), "enabled": map[string]any{"type": "boolean"}, "confirmed": map[string]any{"type": "boolean"}}, "pluginId", "version", "enabled", "confirmed"),
		tool("admin_canvas_plugin_delete", "仅由管理员主动确认后按版本删除未被项目引用的自建节点插件，内置不可删除", "admin", map[string]any{"pluginId": stringField("插件 ID"), "version": numberField("插件记录版本"), "confirmed": map[string]any{"type": "boolean"}}, "pluginId", "version", "confirmed"),
		tool("admin_task_recover_query", "管理员主动核对本人任务的原提交响应并补充其中已有的查询编号；不改脚本快照，不重新生成", "admin", map[string]any{"taskId": stringField("任务 ID"), "upstreamId": stringField("原响应中的可靠任务编号"), "expectedUpdatedAt": stringField("读取任务的 updatedAt"), "confirmed": map[string]any{"type": "boolean"}}, "taskId", "upstreamId", "expectedUpdatedAt", "confirmed"),
		tool("admin_user_create", "管理员主动创建账号", "admin", map[string]any{"username": stringField("用户名"), "password": stringField("初始密码"), "role": map[string]any{"type": "string", "enum": []string{"admin", "user"}}}, "username", "password", "role"),
		tool("admin_user_disable", "管理员停用或恢复账号；不能停用自身", "admin", map[string]any{"userId": stringField("账号 ID"), "disabled": map[string]any{"type": "boolean"}}, "userId", "disabled"),
		tool("admin_user_password", "管理员主动重置账号密码并撤销其网页会话", "admin", map[string]any{"userId": stringField("账号 ID"), "password": stringField("新密码")}, "userId", "password"),
		tool("admin_channels_list", "读取渠道及模型管理配置，不返回凭据", "admin", map[string]any{}),
		tool("admin_model_ordering_get", "读取管理员模型排序，包含停用渠道和模型；orders 使用 channels、channel:<id>、image、video、text、audio、assistant 键", "admin", map[string]any{}),
		tool("admin_model_ordering_save", "按版本保存管理员模型排序；跨渠道排序只影响空白入口首项，不自动切换已有选择或执行路由", "admin", map[string]any{"version": numberField("读取到的排序版本"), "orders": map[string]any{"type": "object", "additionalProperties": map[string]any{"type": "array", "items": stringField("渠道或模型记录 ID")}}}, "version", "orders"),
		tool("admin_channel_save", "创建或按版本修改渠道；凭据仅写入，省略 credential 表示保留现有值", "admin", map[string]any{"channelId": stringField("修改时填写，新建留空"), "config": objectField("name/baseUrl/credential/enabled/version")}, "config"),
		tool("admin_channel_delete", "管理员明确确认后按版本移除渠道及其模型和音色关联；保留已提交任务快照、资产和历史用量", "admin", map[string]any{"channelId": stringField("渠道 ID"), "version": numberField("读取到的渠道版本"), "confirmed": map[string]any{"type": "boolean"}}, "channelId", "version", "confirmed"),
		tool("admin_model_save", "创建或按版本修改渠道模型，明确绑定接口插件不可变版本与参数", "admin", map[string]any{"channelId": stringField("渠道 ID"), "modelId": stringField("修改时填写，新建留空"), "config": objectField("model/name/capability/adapterId/adapterVersionId/parameterOverrides/enabled/version")}, "channelId", "config"),
		tool("admin_models_save", "原子添加同一渠道的多个模型；任一配置失败时全部保留为未写入", "admin", map[string]any{"channelId": stringField("渠道 ID"), "models": map[string]any{"type": "array", "items": objectField("完整模型配置，结构同 admin_model_save.config")}}, "channelId", "models"),
		tool("admin_channel_templates", "读取内置渠道模板；模型初始关闭", "admin", map[string]any{}),
		tool("admin_channel_install", "从模板创建渠道和初始关闭的模型，不调用供应商", "admin", map[string]any{"template": stringField("openai/seedance/minimax"), "name": stringField("可选名称"), "credential": stringField("仅写入的渠道凭据")}, "template", "credential"),
		tool("admin_site_get", "读取站点开关及助手、生成任务并发设置；站点默认开放", "admin", map[string]any{}),
		tool("admin_logging_get", "读取全站后台日志开关；需要管理员及不限项目的 admin 授权", "admin", map[string]any{}),
		tool("admin_logs_read", "读取应用日志占用、总条数及技术日志；支持数字页码或 nextCursor，默认最新 100 条，不返回服务器路径", "admin", map[string]any{"cursor": stringField("上次返回的 nextCursor，与 page / pageSize 分开使用"), "page": map[string]any{"type": "integer", "minimum": 1}, "pageSize": map[string]any{"type": "integer", "enum": []int{20, 50, 100}}}),
		tool("admin_logs_clear", "明确确认后清空应用管理的当前及历史日志文件；不改业务数据或日志开关，服务继续记录新日志", "admin", map[string]any{"confirmed": map[string]any{"type": "boolean"}}, "confirmed"),
		tool("admin_logging_save", "按版本保存后台运行日志与开发诊断开关，立即应用；不返回日志正文或凭据", "admin", map[string]any{"version": numberField("读取到的日志设置版本"), "enabled": map[string]any{"type": "boolean"}, "development": map[string]any{"type": "boolean"}}, "version", "enabled", "development"),
		tool("admin_site_save", "管理员按版本保存站点及并发设置；关闭须 confirmed=true，普通用户退出且不能登录，管理员保留入口，已提交生成继续处理", "admin", map[string]any{"version": numberField("读取版本"), "open": map[string]any{"type": "boolean"}, "assistantSlots": map[string]any{"type": "integer", "minimum": 1}, "generationSlots": map[string]any{"type": "integer", "minimum": 1}, "userSlots": map[string]any{"type": "integer", "minimum": 1}, "confirmed": map[string]any{"type": "boolean"}}, "version", "open", "assistantSlots", "generationSlots", "userSlots"),
		tool("admin_storages_list", "读取五类存储配置，不返回 AccessKey 或 Secret", "admin", map[string]any{}),
		tool("admin_storage_save", "创建或按版本修改存储；最多启用一个，历史资产保持原归属", "admin", map[string]any{"storageId": stringField("修改时填写，新建留空"), "config": objectField("name/provider/endpoint/bucket/region/pathStyle/default/version/accessKeyId/accessKeySecret")}, "config"),
		tool("admin_storage_delete", "移除无文件引用的存储配置，不删除资产", "admin", map[string]any{"storageId": stringField("存储 ID")}, "storageId"),
		tool("admin_script_check", "不调用供应商地编译脚本包，检查输入及请求映射", "admin", map[string]any{"files": objectField("完整文件映射"), "input": objectField("可选标准样例输入"), "baseUrl": stringField("预览地址"), "parameterOverrides": objectField("可选模型参数覆盖，与正式调用共用合并及校验")}, "files"),
        tool("admin_models_remote", "通过已保存渠道的标准 models 接口拉取模型 ID，不创建模型", "admin", map[string]any{"channelId": stringField("渠道 ID")}, "channelId"),
        tool("admin_scripts_list", "查看内置与自建接口插件目录", "admin", map[string]any{}),
		tool("admin_script_contract", "读取接口插件的脚本、素材、参数与工具调用约定；编写草稿前先读取，不含凭据", "admin", map[string]any{"locale": stringField("可选 zh-CN 或 en-US")} ),
		tool("admin_script_get", "读取脚本、草稿和发布版本；内置脚本只读", "admin", map[string]any{"adapterId": stringField("脚本 ID")}, "adapterId"),
		tool("admin_script_delete", "管理员明确确认后按版本删除未被渠道模型引用的自建接口插件、草稿与发布版本；保留任务快照、资产和用量，内置不可删除", "admin", map[string]any{"adapterId": stringField("自建脚本 ID"), "version": numberField("读取到的脚本记录版本"), "confirmed": map[string]any{"type": "boolean"}}, "adapterId", "version", "confirmed"),
		tool("admin_script_create", "创建自建接口插件：提供 name/capability 创建空白包，或提供 files 导入整包；可复制自建脚本，禁止复制内置脚本", "admin", map[string]any{"name": stringField("空白或复制脚本的名称"), "capability": map[string]any{"type": "string", "enum": []string{"text", "image", "video", "audio"}}, "description": stringField("说明"), "copyFrom": stringField("可选自建源脚本 ID，不可与 files 同时使用"), "files": map[string]any{"type": "object", "additionalProperties": map[string]any{"type": "string"}, "description": "可选整包文件映射，从 script.json 读取元数据，仅保存草稿"}}),
		tool("admin_script_draft_save", "按版本保存完整脚本文件包；script.json 的 entry 指向具名阶段导出模块、inputs 指向可视控件定义，JS 可包内相对 import；内置脚本禁止修改", "admin", map[string]any{"adapterId": stringField("脚本 ID"), "revision": numberField("读取版本"), "files": map[string]any{"type": "object", "additionalProperties": map[string]any{"type": "string"}, "description": "完整相对路径到 UTF-8 文件内容的映射，包含 script.json 和参数 JSON；缺少的文件表示删除"}}, "adapterId", "revision", "files"),
		tool("admin_script_publish", "仅由管理员主动发布自建脚本；无需先付费调试，不自动升级模型绑定", "admin", map[string]any{"adapterId": stringField("脚本 ID"), "revision": numberField("草稿版本"), "scriptVersion": numberField("脚本记录版本"), "confirmed": map[string]any{"type": "boolean"}}, "adapterId", "revision", "scriptVersion", "confirmed"),
		tool("admin_script_test", "仅由管理员主动发起真实调试，可能产生费用，返回持久任务", "admin", map[string]any{"adapterId": stringField("脚本 ID"), "config": objectField("channelId/model（完整模型配置）/revision（0 测试已发布版本）/prompt/parameters/references/confirmCharges，必须确认费用")}, "adapterId", "config"),
		tool("admin_script_evidence", "读取当前用户使用此脚本的正式或测试任务、配置快照、用量及已保存的脱敏响应；不发起调用，记录不能证明其他模型或参数可用", "admin", map[string]any{"adapterId": stringField("脚本 ID"), "taskId": stringField("可选任务 ID，省略读取最近一次")}, "adapterId"),
		tool("admin_usage_list", "按用户、项目、渠道、模型、能力及开始执行时间查看全站调用次数与实际、估算或未知用量，不返回积分或价格", "admin", map[string]any{"filters": objectField("userId/projectId/channelId/modelId/capability/from/to")}),
	}
}

func (a *App) callManagement(ctx context.Context, p Principal, name string, input map[string]any) (value any, handled bool, err error) {
	read := func(key string) string { return text(input[key]) }
	decode := func(value any, target any) error { if json.Unmarshal(encode(value), target) != nil { return problem(400, "invalid_input", "工具配置字段或类型不正确") }; return nil }
	if strings.HasPrefix(name, "preference_") && len(p.Projects) > 0 { return nil, true, problem(403, "preference_scope", "全局偏好需要不限项目的授权") }
	if name == "preference_get" { value, err = a.GetPreference(p.User.ID, read("name")); return value, true, err }
	if name == "preference_save" { var request struct { Version uint64 `json:"version"`; Value JSON `json:"value"` }; if err = decode(input, &request); err == nil { value, err = a.SavePreference(p.User.ID, read("name"), request.Version, request.Value) }; return value, true, err }
	if name == "asset_cleanup" {
		if len(p.Projects) > 0 { return nil, true, problem(403, "asset_scope", "全局删除清理需要不限项目的授权") }
		err = a.RetryAssetCleanup(p.User.ID, read("assetId")); return map[string]any{"deleteState": "pending"}, true, err
	}
	switch name {
	case "canvas_nodes_list": value, err = a.ListCanvasNodes()
	case "admin_canvas_plugins_list": value, err = a.ListCanvasPlugins()
	case "admin_canvas_plugin_contract": value = canvasPluginContract(read("locale"))
	case "admin_canvas_plugin_get": value, err = a.GetCanvasPlugin(read("pluginId"))
	case "admin_canvas_plugin_create": value, err = a.CreateCanvasPlugin(p.User, read("name"), read("description"))
	case "admin_canvas_plugin_draft_save": var request struct { Revision uint64 `json:"revision"`; Files map[string]string `json:"files"` }; if err = decode(input, &request); err == nil { value, err = a.SaveCanvasPluginDraft(p.User, read("pluginId"), request.Revision, request.Files) }
	case "admin_canvas_plugin_publish": var request struct { Revision uint64 `json:"revision"`; Version uint64 `json:"version"`; Confirmed bool `json:"confirmed"` }; if err = decode(input, &request); err == nil { value, err = a.PublishCanvasPlugin(p.User, read("pluginId"), request.Revision, request.Version, request.Confirmed) }
	case "admin_canvas_plugin_enabled": var request struct { Version uint64 `json:"version"`; Enabled *bool `json:"enabled"`; Confirmed bool `json:"confirmed"` }; if err = decode(input, &request); err == nil { if !request.Confirmed || request.Enabled == nil { return nil, true, problem(400, "confirmation_required", "节点插件启停须由管理员主动确认") }; value, err = a.SetCanvasPluginEnabled(read("pluginId"), request.Version, *request.Enabled) }
	case "admin_canvas_plugin_delete": var request struct { Version uint64 `json:"version"`; Confirmed bool `json:"confirmed"` }; if err = decode(input, &request); err == nil { err = a.DeleteCanvasPlugin(read("pluginId"), request.Version, request.Confirmed) }
	case "assistant_threads_list": rows := []AssistantThread{}; err = a.db.Where("user_id = ?", p.User.ID).Order("updated_at DESC").Find(&rows).Error; return rows, true, err
	case "assistant_thread_get": value, err = a.GetAssistantThread(p.User.ID, read("threadId"))
	case "assistant_thread_create": value, err = a.CreateAssistantThread(p.User.ID, read("title"))
	case "assistant_thread_delete": err = a.DeleteAssistantThread(p.User.ID, read("threadId"))
	case "assistant_turn_start": var request assistantTurnInput; if err = decode(input, &request); err == nil { value, err = a.StartAssistantTurn(p.User, read("threadId"), request) }
	case "assistant_turn_cancel": err = a.CancelAssistantTurn(p.User.ID, read("turnId"))
	case "assistant_skill_draft_create": var request skillDraftInput; if err = decode(input, &request); err == nil { value, err = a.CreateSkillDraft(p.User.ID, request) }
	case "assistant_skill_draft_get": value, err = a.GetSkillDraft(p.User.ID, read("turnId"))
	case "tokens_list": rows := []AccessToken{}; err = a.db.Where("user_id = ?", p.User.ID).Order("created_at DESC").Find(&rows).Error; return rows, true, err
	case "token_create": var request tokenInput; if err = decode(input, &request); err == nil { for _, scope := range request.Scopes { if !includes(p.Scopes, scope) { return nil, true, problem(403, "scope_escalation", "新令牌权限不能超出当前令牌") } }; value, err = a.CreateToken(p.User, request) }
	case "token_revoke": err = a.RevokeToken(p.User.ID, read("tokenId"))
	case "password_change": err = a.ChangePassword(p.User, read("currentPassword"), read("password"))
	case "admin_users_list": rows := []User{}; err = a.db.Order("created_at").Find(&rows).Error; return rows, true, err
	case "admin_task_recover_query": var request taskQueryRecoveryInput; if err = decode(input, &request); err == nil { value, err = a.RecoverTaskQuery(ctx, p.User, read("taskId"), request) }
	case "admin_user_create": var request userInput; if err = decode(input, &request); err == nil { value, err = a.CreateUser(request) }
	case "admin_user_disable": disabled, ok := input["disabled"].(bool); if !ok { return nil, true, problem(400, "invalid_input", "请明确账号停用状态") }; err = a.SetUserDisabled(p.User.ID, read("userId"), disabled)
	case "admin_user_password": err = a.setPassword(read("userId"), read("password"))
	case "admin_channels_list": value, err = a.ListChannels()
	case "admin_model_ordering_get": value, err = a.GetModelOrdering()
	case "admin_model_ordering_save": var request struct { Version uint64 `json:"version"`; Orders map[string][]string `json:"orders"` }; if err = decode(input, &request); err == nil { value, err = a.SaveModelOrdering(request.Version, request.Orders) }
	case "admin_channel_save": var request channelInput; if err = decode(input["config"], &request); err == nil { value, err = a.SaveChannel(read("channelId"), request) }
	case "admin_channel_delete": var request struct { Version uint64 `json:"version"`; Confirmed bool `json:"confirmed"` }; if err = decode(input, &request); err == nil { err = a.DeleteChannel(read("channelId"), request.Version, request.Confirmed) }
	case "admin_model_save": var request ChannelModel; if err = decode(input["config"], &request); err == nil { value, err = a.SaveChannelModel(read("channelId"), read("modelId"), request) }
	case "admin_models_save": var request []ChannelModel; if err = decode(input["models"], &request); err == nil { value, err = a.SaveChannelModels(read("channelId"), request) }
	case "admin_channel_templates": value = channelTemplates()
	case "admin_channel_install": value, err = a.InstallChannelTemplate(read("template"), read("name"), read("credential"))
	case "admin_site_get": value, err = a.GetSiteSettings()
	case "admin_logging_get": value, err = a.GetLogSettings()
	case "admin_logs_read":
		if input["page"] != nil || input["pageSize"] != nil {
			var request = struct { Page int `json:"page"`; PageSize int `json:"pageSize"` }{1, logReadCount}
			if err = decode(input, &request); err == nil { value, err = a.ReadLogPage(request.Page, request.PageSize) }
		} else { value, err = a.ReadLogs(read("cursor")) }
	case "admin_logs_clear": value, err = a.ClearLogs(input["confirmed"] == true)
	case "admin_logging_save": var request logSettingsInput; if err = decode(input, &request); err == nil { if request.Enabled == nil || request.Development == nil { return nil, true, problem(400, "invalid_logging", "请明确日志和开发诊断开关") }; value, err = a.SaveLogSettings(p.User.ID, request.Version, *request.Enabled, *request.Development) }
	case "admin_site_save": var request siteSettingsInput; if err = decode(input, &request); err == nil { value, err = a.SaveSiteSettings(p.User.ID, request) }
	case "admin_storages_list": value, err = a.ListStorages()
	case "admin_storage_save": var request storageInput; if err = decode(input["config"], &request); err == nil { value, err = a.SaveStorage(read("storageId"), request) }
	case "admin_storage_delete": err = a.DeleteStorage(read("storageId"))
	case "admin_script_check": var request scriptCheckInput; if err = decode(input, &request); err == nil { value, err = a.CheckModelScript(ctx, p.User.ID, request) }
    case "admin_models_remote": value, err = a.DiscoverChannelModels(ctx, read("channelId"))
    case "admin_scripts_list": value, err = a.ListModelScripts()
	case "admin_script_contract": value = modelScriptContract(read("locale"))
	case "admin_script_get": value, err = a.GetModelScript(read("adapterId"))
	case "admin_script_delete": var request struct { Version uint64 `json:"version"`; Confirmed bool `json:"confirmed"` }; if err = decode(input, &request); err == nil { err = a.DeleteModelScript(read("adapterId"), request.Version, request.Confirmed) }
	case "admin_script_create": var request scriptInput; if err = decode(input, &request); err == nil { value, err = a.CreateModelScript(p.User, request) }
	case "admin_script_draft_save": var request ScriptDraft; if err = decode(input, &request); err == nil { value, err = a.SaveScriptDraft(p.User, read("adapterId"), request) }
	case "admin_script_publish": if input["confirmed"] != true { return nil, true, problem(400, "confirmation_required", "接口发布须由管理员主动确认") }; var request struct { Revision uint64 `json:"revision"`; ScriptVersion uint64 `json:"scriptVersion"` }; if err = decode(input, &request); err == nil { value, err = a.PublishModelScript(p.User, read("adapterId"), request.Revision, request.ScriptVersion) }
	case "admin_script_test": var request scriptTestInput; if err = decode(input["config"], &request); err == nil { value, err = a.TestModelScript(p.User, read("adapterId"), request) }
	case "admin_script_evidence": value, err = a.ModelScriptEvidence(p.User.ID, read("adapterId"), read("taskId"))
	case "admin_usage_list": filters := map[string]string{}; if input["filters"] != nil { err = decode(input["filters"], &filters) }; if err == nil { value, err = a.ListUsage("", nil, filters) }
	default: return nil, false, nil
	}
	if value == nil && err == nil { value = map[string]any{"saved": true} }; return value, true, err
}
