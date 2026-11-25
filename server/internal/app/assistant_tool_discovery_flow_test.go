package app

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestAssistantDiscoversToolsAndResumesTheSameTurn(test *testing.T) {
	app := assetFileTestApp(test)
	if err := app.db.AutoMigrate(&AssistantThread{}, &AssistantTurn{}, &AssistantItem{}, &Channel{}, &UsageEntry{}, &Project{}, &ProjectRevision{}, &AssetReference{}); err != nil {
		test.Fatal(err)
	}
	user := User{ID: "owner"}
	thread := AssistantThread{ID: "tool-discovery-thread", UserID: user.ID}
	turn := AssistantTurn{ID: "tool-discovery-turn", ThreadID: thread.ID, UserID: user.ID, Status: "queued"}
	snapshot := assistantSnapshot{Execution: executionSnapshot{Policy: suggestedPolicy(), Model: ChannelModel{Capability: "text", Parameters: JSON(`[]`)}}}
	snapshot.appendMessage(0, map[string]any{"role": "system", "content": "agent"})
	request := AssistantItem{ThreadID: thread.ID, TurnID: turn.ID, UserID: user.ID, ID: "request", Role: "user", Sequence: 1, Text: "核对项目并查找画布制作技能"}
	snapshot.appendMessage(request.Sequence, map[string]any{"role": "user", "content": request.Text})
	turn.Snapshot = encode(snapshot)
	project := Project{ID: "existing-project", UserID: user.ID, Title: "现有画布", Version: 1, Document: JSON(`{"nodes":[],"connections":[]}`)}
	for _, row := range []any{&thread, &turn, &request, &project} {
		if err := app.db.Create(row).Error; err != nil {
			test.Fatal(err)
		}
	}
	call := func(id, name, arguments string) map[string]any {
		return map[string]any{"id": id, "type": "function", "function": map[string]any{"name": name, "arguments": arguments}}
	}
	result := func(calls ...map[string]any) (providerResult, error) {
		return providerResult{Status: "completed", ToolCalls: calls}, nil
	}
	toolBody := func(messages []map[string]any, id string) JSON {
		test.Helper()
		for _, message := range messages {
			if message["role"] == "tool" && message["tool_call_id"] == id {
				return JSON(text(message["content"]))
			}
		}
		test.Fatalf("missing result matched to tool call %q", id)
		return nil
	}
	readTurn := func() (AssistantTurn, assistantSnapshot) {
		test.Helper()
		var stored AssistantTurn
		if err := app.db.First(&stored, "id = ?", turn.ID).Error; err != nil {
			test.Fatal(err)
		}
		var resumed assistantSnapshot
		if err := json.Unmarshal(stored.Snapshot, &resumed); err != nil {
			test.Fatal(err)
		}
		return stored, resumed
	}
	ctx := context.Background()
	modelCalls := 0
	callText := func(_ context.Context, running AssistantTurn, _ executionSnapshot, messages []map[string]any, _ map[string]any, _ []assetInput, tools []map[string]any, _ func(string, string) error) (providerResult, error) {
		modelCalls++
		if running.ID != turn.ID || !assistantContextToolsSettled(messages) {
			test.Fatal("the next model request changed turns or received unmatched tool history")
		}
		advertised := map[string]bool{}
		for _, tool := range tools {
			name := assistantToolName(tool)
			if tool["type"] != "function" || tool["defer_loading"] != nil || name == "" || advertised[name] {
				test.Fatalf("unexpected nonstandard or duplicate tool definition: %v", tool)
			}
			advertised[name] = true
		}
		for _, name := range []string{assistantLoadToolsName, "ask_user", "update_todos"} {
			if !advertised[name] {
				test.Fatalf("core tool missing after discovery or resume: %s", name)
			}
		}
		switch modelCalls {
		case 1:
			if len(advertised) != 3 {
				test.Fatalf("first request announced business definitions: %v", advertised)
			}
			return result(call("load-canvas", assistantLoadToolsName, `{"group":"canvas"}`),
				call("additional-load", assistantLoadToolsName, `{"group":"library"}`),
				call("unadvertised-create", "project_create", `{"title":"不应创建","document":{"nodes":[],"connections":[]}}`))
		case 2:
			if !advertised["project_create"] || !advertised["projects_list"] || advertised["skill_get"] {
				test.Fatalf("the next request did not load just the canvas group: %v", advertised)
			}
			var loaded struct {
				Group string   `json:"group"`
				Tools []string `json:"tools"`
			}
			if err := json.Unmarshal(toolBody(messages, "load-canvas"), &loaded); err != nil || loaded.Group != "canvas" || !includes(loaded.Tools, "project_create") {
				test.Fatalf("unexpected group discovery result: %+v (%v)", loaded, err)
			}
			if code := objectFromJSON(toolBody(messages, "unadvertised-create"))["code"]; code != "tool_not_allowed" {
				test.Fatalf("an unadvertised same-batch write was not rejected: %v", code)
			}
			if code := objectFromJSON(toolBody(messages, "additional-load"))["code"]; code != "invalid_tool_arguments" {
				test.Fatalf("a second selection in the same batch was not rejected: %v", code)
			}
			return result(call("question", "ask_user", `{"question":"检查草图还是定稿？","options":["草图","定稿"]}`))
		case 3:
			if !advertised["projects_list"] || advertised["skill_get"] || objectFromJSON(toolBody(messages, "question"))["answer"] != "定稿" {
				test.Fatal("the resumed request lost its selected group or the user's answer")
			}
			return result(call("load-library", assistantLoadToolsName, `{"group":"library"}`), call("read-projects", "projects_list", `{}`))
		case 4:
			if !advertised["skill_get"] || advertised["projects_list"] || objectFromJSON(toolBody(messages, "load-library"))["group"] != "library" {
				test.Fatal("the new group did not replace the old group")
			}
			var projects []Project
			if err := json.Unmarshal(toolBody(messages, "read-projects"), &projects); err != nil || len(projects) != 1 || projects[0].ID != project.ID {
				test.Fatalf("the advertised sibling did not execute before the group switched: %+v (%v)", projects, err)
			}
			verifyAssistantDiscoveryAdapterRequests(test, app, snapshot.Execution, messages, tools)
			return result(call("read-skill", "skill_get", `{"name":"canvas-composition"}`))
		case 5:
			if !advertised["skill_get"] || advertised["projects_list"] || objectFromJSON(toolBody(messages, "read-skill"))["name"] != "canvas-composition" {
				test.Fatal("the selected library tool did not return a result")
			}
			return providerResult{Status: "completed", Text: "已核对项目和技能。"}, nil
		}
		test.Fatal("unexpected extra model request")
		return providerResult{}, nil
	}
	app.executeAssistantWithText(ctx, turn.ID, callText)
	waiting, saved := readTurn()
	if waiting.Status != assistantWaitingUser || saved.ToolGroup != "canvas" || saved.WaitingQuestionID != "question" || modelCalls != 2 {
		test.Fatalf("the waiting turn did not save its discovery state: %s / %s / %d", waiting.Status, saved.ToolGroup, modelCalls)
	}
	answered, err := app.AnswerAssistantTurn(user, turn.ID, assistantAnswerInput{QuestionID: "question", Answer: "定稿"})
	if err != nil || answered.ID != turn.ID || answered.Status != "queued" {
		test.Fatalf("question answer did not queue the original turn: %+v (%v)", answered, err)
	}
	app.executeAssistantWithText(ctx, turn.ID, callText)
	finished, saved := readTurn()
	if finished.Status != "succeeded" || saved.ToolGroup != "library" || !assistantContextToolsSettled(saved.Messages) || modelCalls != 5 {
		test.Fatalf("the resumed turn did not complete with paired history: %s / %s / %d", finished.Status, saved.ToolGroup, modelCalls)
	}
	var projects []Project
	if err := app.db.Find(&projects).Error; err != nil || len(projects) != 1 || projects[0].ID != project.ID || finished.ProjectID != "" {
		test.Fatalf("unadvertised creation changed project data: %+v (%v)", projects, err)
	}
}

func verifyAssistantDiscoveryAdapterRequests(test *testing.T, app *App, execution executionSnapshot, messages, tools []map[string]any) {
	test.Helper()
	builtins, err := builtinScripts()
	if err != nil {
		test.Fatal(err)
	}
	verified := 0
	for _, builtin := range builtins {
		if builtin.ID != "openai-chat" && builtin.ID != "openai-responses" {
			continue
		}
		var scripts map[string]string
		if err := json.Unmarshal(builtin.Scripts, &scripts); err != nil {
			test.Fatal(err)
		}
		request, err := app.runScript(context.Background(), execution, "submit", scripts["submit"], map[string]any{"model": "fixture-text", "messages": messages, "tools": tools})
		if err != nil {
			test.Fatal(err)
		}
		body := object(request["body"])
		wireTools := array(body["tools"])
		encoded := string(encode(body))
		if len(wireTools) != len(tools) || strings.Count(encoded, `"unadvertised-create"`) != 2 || strings.Count(encoded, `"read-projects"`) != 2 {
			test.Fatalf("adapter %s did not preserve the new tool list or matched calls from the previous group", builtin.ID)
		}
		for index, raw := range wireTools {
			tool := object(raw)
			name := assistantToolName(tool)
			if builtin.ID == "openai-responses" {
				name = text(tool["name"])
			}
			if tool["type"] != "function" || tool["defer_loading"] != nil || name != assistantToolName(tools[index]) {
				test.Fatalf("adapter %s sent an incompatible tool definition: %v", builtin.ID, tool)
			}
		}
		verified++
	}
	if verified != 2 {
		test.Fatal("expected both built-in text adapters")
	}
}
