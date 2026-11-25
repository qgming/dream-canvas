package app

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"unicode/utf8"

	"gorm.io/gorm"
)

func TestAssistantTimelineShowsPartialReasoningAndSafeToolDetails(t *testing.T) {
	a := assetFileTestApp(t)
	if err := a.db.AutoMigrate(&Channel{}, &AssistantThread{}, &AssistantTurn{}, &AssistantItem{}); err != nil { t.Fatal(err) }
	thread := AssistantThread{ID: "thread", UserID: "owner"}
	turn := AssistantTurn{ID: "turn", ThreadID: thread.ID, UserID: thread.UserID, Status: "running"}
	taskID := identifier()
	for _, row := range []any{&thread, &turn, &AssistantItem{
		ID: "reply", ThreadID: thread.ID, TurnID: turn.ID, UserID: thread.UserID, Sequence: 1, Role: "assistant",
		Detail: JSON(`{"reasoning":"First step sk-demo-test-key","streaming":true,"responseItems":[{"encrypted_content":"private"}],"toolCalls":[{"function":{"arguments":"private"}}]}`),
	}, &AssistantItem{
		ID: "pending", ThreadID: thread.ID, TurnID: turn.ID, UserID: thread.UserID, Sequence: 2, Role: "tool",
		Text: `{"id":"` + taskID + `","status":"queued","input":{"prompt":"private"}}`,
		Detail: JSON(`{"kind":"tool","status":"pending","name":"generation_create"}`),
	}, &AssistantItem{
		ID: "running", ThreadID: thread.ID, TurnID: turn.ID, UserID: thread.UserID, Sequence: 3, Role: "tool",
		Detail: JSON(`{"kind":"tool","status":"running","name":"project_save"}`),
	}, &AssistantItem{
		ID: "assets", ThreadID: thread.ID, TurnID: turn.ID, UserID: thread.UserID, Sequence: 4, Role: "tool",
		Text: `[{"title":"分镜参考", "metadata":{"text":"PRIVATE_PROMPT"}}, {"title":"封面 https://example.test/?signature=PRIVATE_SIGNATURE"}, {"title":"sk-demo-test-key"}, {"title":"` + strings.Repeat("图", 81) + `"}, {"title":"NOT_IN_PREVIEW"}]`,
		Detail: JSON(`{"kind":"tool","status":"completed","name":"assets_list","arguments":{"secret":"PRIVATE_ARGUMENT"}}`),
	}, &AssistantItem{
		ID: "canvas", ThreadID: thread.ID, TurnID: turn.ID, UserID: thread.UserID, Sequence: 5, Role: "tool",
		Text: `{"title":"城市夜景","document":{"nodes":[{"text":"PRIVATE_NODE"}],"connections":[]}}`,
		Detail: JSON(`{"kind":"tool","status":"completed","name":"canvas_apply_ops"}`),
	}, &AssistantItem{
		ID: "tasks", ThreadID: thread.ID, TurnID: turn.ID, UserID: thread.UserID, Sequence: 6, Role: "tool",
		Text: `[{"id":"` + taskID + `","status":"succeeded","text":"PRIVATE_RESULT"},{"id":"not-a-task-id","status":"running"}]`,
		Detail: JSON(`{"kind":"tool","status":"completed","name":"tasks_list"}`),
	}} {
		if err := a.db.Create(row).Error; err != nil { t.Fatal(err) }
	}
	read := func() []AssistantItem {
		t.Helper()
		view, err := a.GetAssistantThread(thread.UserID, thread.ID)
		if err != nil { t.Fatal(err) }
		return view["items"].([]AssistantItem)
	}
	items := read()
	reasoning := objectFromJSON(items[0].Detail)
	if reasoning["reasoning"] != "First step [REDACTED]" || reasoning["streaming"] != true || strings.Contains(string(items[0].Detail), "private") {
		t.Fatalf("unexpected readable reasoning detail: %s", items[0].Detail)
	}
	pending := objectFromJSON(items[1].Detail)
	if items[1].Text != "" || pending["status"] != "pending" || pending["taskStatus"] != "queued" || string(encode(pending["taskIds"])) != string(encode([]string{taskID})) {
		t.Fatalf("expected safe queued task view: %+v", pending)
	}
	if objectFromJSON(items[2].Detail)["status"] != "running" { t.Fatal("live tool was not marked running") }
	assets := objectFromJSON(items[3].Detail)
	previews := array(assets["resultPreview"])
	if items[3].Text != "" || assets["resultCount"] != float64(5) || len(previews) != 4 || previews[0] != "分镜参考" || previews[1] != "封面 [REDACTED URL]" || previews[2] != "[REDACTED]" || utf8.RuneCountInString(text(previews[3])) != 80 || strings.Contains(string(items[3].Detail), "PRIVATE_") || strings.Contains(string(items[3].Detail), "NOT_IN_PREVIEW") {
		t.Fatalf("expected only a few redacted, bounded asset labels: %s", items[3].Detail)
	}
	canvas := objectFromJSON(items[4].Detail)
	if items[4].Text != "" || canvas["nodeCount"] != float64(1) || canvas["connectionCount"] != float64(0) || string(encode(canvas["resultPreview"])) != string(encode([]string{"城市夜景"})) || strings.Contains(string(items[4].Detail), "PRIVATE_NODE") {
		t.Fatalf("expected a canvas summary without node content: %s", items[4].Detail)
	}
	tasks := objectFromJSON(items[5].Detail)
	if items[5].Text != "" || tasks["resultCount"] != float64(2) || string(encode(tasks["tasks"])) != string(encode([]map[string]string{{"id": taskID, "status": "succeeded"}})) || strings.Contains(string(items[5].Detail), "PRIVATE_RESULT") {
		t.Fatalf("expected only a task link and its recorded status: %s", items[5].Detail)
	}
	var stored AssistantItem
	if err := a.db.First(&stored, "thread_id = ? AND turn_id = ? AND id = ?", thread.ID, turn.ID, "assets").Error; err != nil || !strings.Contains(stored.Text, "PRIVATE_PROMPT") { t.Fatal("preview changed the stored result", err) }
	if err := a.db.Model(&turn).Update("status", "interrupted").Error; err != nil { t.Fatal(err) }
	items = read()
	if objectFromJSON(items[0].Detail)["streaming"] == true || objectFromJSON(items[0].Detail)["reasoning"] != reasoning["reasoning"] || objectFromJSON(items[2].Detail)["status"] != "interrupted" {
		t.Fatal("interruption must retain received reasoning and clear live states")
	}
}

func TestAssistantThreadTitlesFollowFirstAcceptedMessageAndRespectRename(t *testing.T) {
	a := assetFileTestApp(t)
	if err := a.db.AutoMigrate(&Channel{}, &ChannelModel{}, &ScriptVersion{}, &AssistantThread{}, &AssistantTurn{}, &AssistantItem{}); err != nil { t.Fatal(err) }
	var err error
	if a.credentials, err = openKey(a.root); err != nil { t.Fatal(err) }
	secret, err := a.encryptSecret("saved-provider-credential")
	if err != nil { t.Fatal(err) }
	for _, row := range []any{
		&Channel{ID: "channel", Secret: secret, Enabled: true},
		&ChannelModel{ID: "model", ChannelID: "channel", AdapterID: "adapter", AdapterVersionID: "version", Capability: "text", Enabled: true},
		&ScriptVersion{ID: "version", AdapterID: "adapter", Features: JSON(`{"tools":true}`), Parameters: JSON(`[]`), Scripts: JSON(`{}`)},
	} { if err := a.db.Create(row).Error; err != nil { t.Fatal(err) } }
	user := User{ID: "owner"}
	thread, err := a.CreateAssistantThread(user.ID, "")
	if err != nil || thread.Title != "" { t.Fatalf("expected a new placeholder: %+v, %v", thread, err) }
	input := assistantTurnInput{ChannelID: "channel", ModelID: "missing", Version: thread.Version, Prompt: "你好！请帮我整理城市夜景的分镜。\n第二句是补充要求。"}
	if _, err := a.StartAssistantTurn(user, thread.ID, input); err == nil { t.Fatal("invalid model accepted") }
	read := func() AssistantThread {
		t.Helper()
		var value AssistantThread
		if err := a.db.First(&value, "id = ?", thread.ID).Error; err != nil { t.Fatal(err) }
		return value
	}
	if current := read(); current.Title != "" || current.Version != thread.Version { t.Fatal("a rejected request changed the title", current) }
	input.ModelID = "model"
	turn, err := a.StartAssistantTurn(user, thread.ID, input)
	if err != nil { t.Fatal(err) }
	if current := read(); current.Title != "整理城市夜景的分镜" || current.Version != thread.Version + 1 { t.Fatal("first accepted message did not set the summary", current) }
	if err := a.CancelAssistantTurn(user.ID, turn.ID); err != nil { t.Fatal(err) }
	if _, err := a.RenameAssistantThread("other", thread.ID, assistantRenameInput{Title: "不应修改", Version: read().Version}); !errors.Is(err, gorm.ErrRecordNotFound) { t.Fatalf("rename was not owner scoped: %v", err) }
	if _, err := a.RenameAssistantThread(user.ID, thread.ID, assistantRenameInput{Title: "旧版本", Version: thread.Version}); err == nil { t.Fatal("stale rename was accepted") }
	updated, err := a.RenameAssistantThread(user.ID, thread.ID, assistantRenameInput{Title: " 新对话 ", Version: read().Version})
	if err != nil || updated.Title != "新对话" { t.Fatalf("explicit rename failed: %+v, %v", updated, err) }
	input.Prompt, input.Version = "请改写第二个镜头", updated.Version
	if _, err := a.StartAssistantTurn(user, thread.ID, input); err != nil { t.Fatal(err) }
	if current := read(); current.Title != "新对话" { t.Fatal("later message overwrote the manually chosen title", current) }
}

func TestAssistantMaterialsKeepsFailedToolCallsReplayable(t *testing.T) {
	a := assetFileTestApp(t)
	if err := a.db.AutoMigrate(&Channel{}); err != nil { t.Fatal(err) }
	snapshot := assistantSnapshot{Execution: executionSnapshot{Model: ChannelModel{Parameters: JSON(`[]`)}}}
	if err := json.Unmarshal([]byte(`[
		{"role":"assistant","tool_calls":[
			{"id":"saved","type":"function","function":{"name":"asset_text_create","arguments":"{\"title\":\"Saved\"}"}},
			{"id":"rejected","type":"function","function":{"name":"asset_text_create","arguments":"{\"title\":\"Unfinished\""}}
		],"responseItems":[
			{"type":"function_call","call_id":"saved","name":"asset_text_create","arguments":"{\"title\":\"Saved\"}"},
			{"type":"function_call","call_id":"rejected","name":"asset_text_create","arguments":"{\"title\":\"Unfinished\""}
		]},
		{"role":"tool","tool_call_id":"saved","content":"{\"id\":\"asset\"}"},
		{"role":"tool","tool_call_id":"rejected","content":"{\"code\":\"invalid_tool_arguments\"}"},
		{"role":"user","content":"继续"}
	]`), &snapshot.Messages); err != nil { t.Fatal(err) }
	stored := string(encode(snapshot.Messages))
	messages, _, err := a.assistantMaterials(snapshot)
	if err != nil { t.Fatal(err) }
	if string(encode(snapshot.Messages)) != stored { t.Fatal("stored tool history changed") }
	if len(messages) != len(snapshot.Messages) || string(encode(messages[1:])) != string(encode(snapshot.Messages[1:])) { t.Fatal("tool results or user follow-up changed") }
	calls, items := array(messages[0]["tool_calls"]), array(messages[0]["responseItems"])
	if len(calls) != 2 || len(items) != 2 { t.Fatal("tool calls were dropped") }
	for index, expected := range []struct{ id, arguments string }{{"saved", `{"title":"Saved"}`}, {"rejected", `{}`}} {
		call, item := object(calls[index]), object(items[index])
		if call["id"] != expected.id || item["call_id"] != expected.id || object(call["function"])["arguments"] != expected.arguments || item["arguments"] != expected.arguments {
			t.Fatalf("tool call %s did not retain its pairing and valid replay arguments", expected.id)
		}
	}
}

func TestAssistantReasoningAdaptersReadProviderStreams(t *testing.T) {
	builtins, err := builtinScripts()
	if err != nil { t.Fatal(err) }
	for _, fixture := range []struct { adapter, trace, first, final string }{
		{"openai-chat", `{"choices":[{"delta":{"reasoning":"First"}}]}
{"choices":[{"delta":{"reasoning":" step"}}]}
{"choices":[{"delta":{"content":"Answer"},"finish_reason":"stop"}]}`, "First", "First step"},
		{"openai-responses", `{"type":"response.reasoning_summary_text.delta","output_index":0,"summary_index":0,"delta":"First"}
{"type":"response.reasoning_summary_text.done","output_index":0,"summary_index":0,"text":"First step"}
{"type":"response.output_item.done","output_index":0,"item":{"type":"reasoning","encrypted_content":"opaque","summary":[]}}
{"type":"response.output_text.delta","delta":"Answer"}
{"type":"response.completed","response":{"id":"response"}}`, "First", "First step"},
	} {
		t.Run(fixture.adapter, func(t *testing.T) {
			var version *ScriptVersion
			for _, script := range builtins { if script.ID == fixture.adapter { version = &ScriptVersion{Scripts: script.Scripts}; break } }
			if version == nil { t.Fatal("missing builtin adapter") }
			var fixtureStream strings.Builder
			for _, event := range strings.Split(fixture.trace, "\n") { fixtureStream.WriteString("data: " + event + "\n\n") }
			response := &http.Response{Body: io.NopCloser(strings.NewReader(fixtureStream.String()))}
			a := &App{}
			snapshot := executionSnapshot{Script: version, Policy: suggestedPolicy()}
			first := ""
			state, err := a.readScriptStream(context.Background(), snapshot, response, nil, func(state map[string]any) error {
				if first == "" { first = text(state["reasoning"]); if text(state["text"]) != "" { t.Fatal("reasoning arrived after the reply") } }
				return nil
			})
			if err != nil { t.Fatal(err) }
			scripts := map[string]string{}
			if err := json.Unmarshal(version.Scripts, &scripts); err != nil { t.Fatal(err) }
			result, err := a.runScript(context.Background(), snapshot, "result", scripts["result"], map[string]any{"response": state})
			if err != nil { t.Fatal(err) }
			if first != fixture.first || result["reasoning"] != fixture.final || result["text"] != "Answer" { t.Fatalf("unexpected streamed reasoning or answer: %+v", result) }
		})
	}
}
