package app

import (
	"slices"
	"testing"
)

func TestAssistantToolGroupsCoverBusinessCatalogOnce(test *testing.T) {
	grouped := map[string]string{}
	groups := map[string]bool{}
	for _, group := range assistantToolGroupCatalog {
		if group.ID == "" || group.Description == "" || groups[group.ID] || len(group.Names) == 0 {
			test.Fatalf("invalid or duplicate assistant tool group: %q", group.ID)
		}
		groups[group.ID] = true
		for _, name := range group.Names {
			if previous := grouped[name]; previous != "" {
				test.Fatalf("tool %s belongs to both %s and %s", name, previous, group.ID)
			}
			grouped[name] = group.ID
		}
	}
	for _, tool := range businessTools() {
		if grouped[tool.Name] == "" {
			test.Fatalf("unclassified or duplicate business tool: %s", tool.Name)
		}
		delete(grouped, tool.Name)
	}
	if len(grouped) != 0 {
		test.Fatalf("unknown tools in assistant groups: %v", grouped)
	}
}

func TestAssistantLoadsOnlyTheSelectedPermittedGroup(test *testing.T) {
	principal := Principal{User: User{Role: "user"}, Scopes: []string{"read", "assistant", "admin"}, FixedProject: true}
	tools := assistantTools(principal)
	initial := selectedAssistantTools(tools, "")
	if len(initial) != 3 || assistantToolName(initial[0]) != "ask_user" || assistantToolName(initial[1]) != "update_todos" || assistantToolName(initial[2]) != assistantLoadToolsName {
		test.Fatalf("fallback included definitions before discovery: %v", initial)
	}
	schema := object(object(initial[2]["function"])["parameters"])
	groupSchema := object(object(schema["properties"])["group"])
	available, _ := groupSchema["enum"].([]string)
	if !includes(available, "assets") || !includes(available, "library") || includes(available, "admin_models") || includes(available, "live_canvas") || !slices.Equal(schema["required"].([]string), []string{"group"}) {
		test.Fatalf("fallback group choices are incorrect: %v", available)
	}
	groupID, names, err := loadAssistantToolGroup(tools, map[string]any{"group": "assets"})
	if err != nil || groupID != "assets" || !slices.Equal(names, []string{"asset_projects_list", "assets_list", "asset_get", "asset_voices"}) {
		test.Fatalf("unexpected permitted asset group: %s %v %v", groupID, names, err)
	}
	use := func(group string) []string {
		names := []string{}
		for _, tool := range selectedAssistantTools(tools, group) {
			names = append(names, assistantToolName(tool))
		}
		return names
	}
	if names := use(groupID); !includes(names, "asset_get") || includes(names, "asset_delete") || includes(names, "skill_get") {
		test.Fatalf("fallback loaded an unauthorized tool or another group: %v", names)
	}
	if names := use("library"); !includes(names, "skill_get") || includes(names, "asset_get") {
		test.Fatalf("fallback did not replace the selected group: %v", names)
	}
	for _, input := range []map[string]any{{"group": "admin_models"}, {"group": "unknown"}, {"group": "assets", "name": "asset_delete"}, {"group": []any{"assets"}}} {
		if group, names, err := loadAssistantToolGroup(tools, input); err == nil || group != "" || len(names) != 0 {
			test.Fatalf("invalid discovery granted tools for %v: %s %v %v", input, group, names, err)
		}
	}
	if len(use("admin_models")) != len(initial) || selectedAssistantTools(nil, "assets") != nil {
		test.Fatal("stale selection or empty configured catalog unexpectedly granted tools")
	}
	principal.ClientID = "bound-canvas"
	tools = assistantTools(principal)
	if names := use("live_canvas"); !includes(names, "client_get") || includes(names, "client_select") {
		test.Fatalf("bound client group did not preserve read and edit permissions: %v", names)
	}
	principal.User.Role = "admin"
	tools = assistantTools(principal)
	if names := use("admin_site"); !includes(names, "admin_script_runtime_save") || includes(names, "admin_site_save") {
		test.Fatalf("admin group bypassed direct-user action policy or lost a permitted tool: %v", names)
	}
}

func TestAssistantToolDiscoveryTimelineOmitsRawResult(test *testing.T) {
	detail := map[string]any{"name": assistantLoadToolsName, "status": "completed"}
	body := `{"group":"assets","tools":["asset_get"]}`
	view := objectFromJSON(assistantToolView(detail, body, false, func(value string) string { return value }))
	if view["toolGroup"] != "assets" || view["tools"] != nil || view["resultPreview"] != nil {
		test.Fatalf("expected only the selected group in the timeline: %v", view)
	}
}
