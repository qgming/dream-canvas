package app

import "strings"

const assistantLoadToolsName = "load_tools"

var assistantToolGroupCatalog = []struct {
	ID, Description string
	Names           []string
}{
	{"canvas", "查找、新建、编辑画布项目及节点、连线和版本历史。", []string{"projects_list", "project_get", "project_create", "project_save", "project_delete", "project_history", "project_revert", "canvas_nodes_list", "canvas_apply_ops"}},
	{"live_canvas", "读取已绑定在线画布的选区或调整其页面、视口和选中节点。", []string{"clients_list", "client_get", "client_select", "client_viewport", "client_navigate", "client_command_get"}},
	{"assets", "按资产项目查找、读取、保存、移动和删除私人素材，管理资产项目和音色关联。", []string{"asset_projects_list", "asset_project_create", "asset_project_rename", "asset_project_delete", "assets_list", "asset_get", "asset_content", "asset_move", "asset_delete", "asset_update", "asset_text_create", "asset_voices", "asset_voice_save"}},
	{"asset_storage", "读取素材的可用存储，重试同步或清理，迁移云端副本。", []string{"asset_storages", "asset_sync", "asset_migrate", "asset_cleanup"}},
	{"library", "在灵感库查找、读取和编辑提示词及 Skill。", []string{"prompts_search", "prompt_get", "prompt_save", "prompt_delete", "skills_list", "skill_get", "skill_save", "skill_delete"}},
	{"generation", "查找可用生成模型与参数，提交、等待、查询或停止生成任务。", []string{"catalog_list", "generation_create", "tasks_list", "task_get", "tasks_wait", "task_cancel", "task_resume", "task_resolve", "task_delete"}},
	{"workbench", "读取、保存或移除图片和视频工作台记录。", []string{"workbench_records", "workbench_record_save", "workbench_record_remove"}},
	{"account", "读取用量，管理个人画布偏好与自己的访问令牌记录。", []string{"usage_list", "preference_get", "preference_save", "tokens_list", "token_create", "token_revoke", "password_change"}},
	{"assistant_history", "读取、创建助手会话，查看 Skill 草稿任务。", []string{"assistant_threads_list", "assistant_thread_get", "assistant_thread_create", "assistant_thread_rename", "assistant_thread_delete", "assistant_turn_start", "assistant_turn_cancel", "assistant_turn_answer", "assistant_skill_draft_create", "assistant_skill_draft_get"}},
	{"admin_models", "管理渠道、模型配置和使用顺序，读取预设及渠道模型目录。", []string{"admin_channels_list", "admin_channel_save", "admin_channel_delete", "admin_channel_templates", "admin_channel_install", "admin_model_ordering_get", "admin_model_ordering_save", "admin_model_save", "admin_models_save", "admin_models_remote"}},
	{"admin_scripts", "读取接口插件约定、草稿及任务证据，创建、修改或静态检查草稿。", []string{"admin_scripts_list", "admin_script_contract", "admin_script_get", "admin_script_create", "admin_script_draft_save", "admin_script_check", "admin_script_evidence", "admin_script_publish", "admin_script_delete", "admin_script_test", "admin_task_recover_query"}},
	{"admin_canvas_plugins", "读取节点插件目录与 SDK 约定，创建、读取或保存节点插件草稿。", []string{"admin_canvas_plugins_list", "admin_canvas_plugin_contract", "admin_canvas_plugin_get", "admin_canvas_plugin_create", "admin_canvas_plugin_draft_save", "admin_canvas_plugin_publish", "admin_canvas_plugin_enabled", "admin_canvas_plugin_delete"}},
	{"admin_site", "读取站点配置，调整接口插件运行参数，查看或停用账号。", []string{"admin_site_get", "admin_site_save", "admin_script_runtime_save", "admin_users_list", "admin_user_create", "admin_user_password", "admin_user_disable"}},
	{"admin_observability", "管理应用日志，读取应用日志和全站调用统计。", []string{"admin_logging_get", "admin_logging_save", "admin_logs_read", "admin_logs_clear", "admin_usage_list"}},
	{"admin_storage", "读取并管理站点对象存储配置，不读取或填写凭据。", []string{"admin_storages_list", "admin_storage_save", "admin_storage_test", "admin_storage_delete"}},
}

type assistantToolGroup struct {
	ID, Description string
	Tools           []map[string]any
}

func assistantToolName(tool map[string]any) string {
	return text(object(tool["function"])["name"])
}

func groupAssistantTools(tools []map[string]any) (core []map[string]any, groups []assistantToolGroup) {
	byName := make(map[string]map[string]any, len(tools))
	for _, tool := range tools {
		byName[assistantToolName(tool)] = tool
	}
	for _, interaction := range assistantInteractionTools() {
		if tool := byName[interaction.Name]; tool != nil {
			core = append(core, tool)
		}
	}
	for _, entry := range assistantToolGroupCatalog {
		group := assistantToolGroup{ID: entry.ID, Description: entry.Description}
		for _, name := range entry.Names {
			if tool := byName[name]; tool != nil {
				group.Tools = append(group.Tools, tool)
			}
		}
		if len(group.Tools) > 0 {
			groups = append(groups, group)
		}
	}
	return core, groups
}

func selectedAssistantTools(tools []map[string]any, groupID string) []map[string]any {
	result, groups := groupAssistantTools(tools)
	if len(groups) == 0 {
		return result
	}
	var selected []map[string]any
	ids, descriptions := make([]string, 0, len(groups)), make([]string, 0, len(groups))
	for _, group := range groups {
		ids = append(ids, group.ID)
		descriptions = append(descriptions, group.ID+"："+group.Description)
		if group.ID == groupID {
			selected = group.Tools
		}
	}
	result = append(result, map[string]any{"type": "function", "function": map[string]any{
		"name": assistantLoadToolsName, "description": "按需选择一个业务组，从下一次模型请求开始直接调用组内工具。选择新组会替换当前组，不执行任何业务。",
		"parameters": toolSchema(map[string]any{"group": map[string]any{"type": "string", "enum": ids, "description": strings.Join(descriptions, " ")}}, "group"),
	}})
	return append(result, selected...)
}

func loadAssistantToolGroup(tools []map[string]any, arguments map[string]any) (string, []string, error) {
	groupID, valid := arguments["group"].(string)
	if valid && len(arguments) == 1 {
		_, groups := groupAssistantTools(tools)
		for _, group := range groups {
			if group.ID != groupID {
				continue
			}
			names := make([]string, 0, len(group.Tools))
			for _, tool := range group.Tools {
				names = append(names, assistantToolName(tool))
			}
			return group.ID, names, nil
		}
	}
	return "", nil, problem(400, "invalid_tool_arguments", "请选择本轮目录中的可用工具组")
}
