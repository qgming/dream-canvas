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

func TestAssistantTitlesFirstSuccessfulTurn(t *testing.T) {
	const reply = "正文已保存。"
	const prompt = "请整理城市夜景分镜。saved-provider-credential\nhttps://example.test/private?signature=private"
	const safePrompt = "请整理城市夜景分镜。[REDACTED]\n[REDACTED URL]"
	const modelTitle = "  城市夜景分镜创作建议草案\n不保留第二行  "
	const shortTitle = "城市夜景分镜创作建议"
	for _, fixture := range []struct {
		name, previous string
		failTitle, rename bool
	}{
		{name: "model title"},
		{name: "failed reply does not consume naming", previous: "failed"},
		{name: "cancelled reply does not consume naming", previous: "cancelled"},
		{name: "failed title is not retried", failTitle: true},
		{name: "concurrent manual title wins", rename: true},
	} {
		t.Run(fixture.name, func(test *testing.T) {
			app := assetFileTestApp(test)
			if err := app.db.AutoMigrate(&Channel{}, &ChannelModel{}, &ScriptVersion{}, &AssistantThread{}, &AssistantTurn{}, &AssistantItem{}, &UsageEntry{}); err != nil { test.Fatal(err) }
			var err error
			if app.credentials, err = openKey(app.root); err != nil { test.Fatal(err) }
			secret, err := app.encryptSecret("saved-provider-credential")
			if err != nil { test.Fatal(err) }
			user := User{ID: "owner"}
			for _, row := range []any{
				&Channel{ID: "channel", Secret: secret, Enabled: true},
				&ChannelModel{ID: "model", ChannelID: "channel", Model: "selected-model", AdapterID: "adapter", AdapterVersionID: "version", Capability: "text", Enabled: true},
				&ScriptVersion{ID: "version", AdapterID: "adapter", Features: JSON(`{"tools":true}`), Parameters: JSON(`[{"key":"systemPrompt","label":"Instructions","type":"text"},{"key":"reference","label":"Image","type":"asset","role":"image","transport":"data"}]`), Scripts: JSON(`{}`)},
				&Asset{ID: "reference-image", UserID: user.ID, Kind: "image", SaveState: "saved", Metadata: JSON(`{}`)},
			} { if err := app.db.Create(row).Error; err != nil { test.Fatal(err) } }
			thread, err := app.CreateAssistantThread(user.ID, "")
			if err != nil || thread.Title != "" { test.Fatalf("expected a new placeholder: %+v, %v", thread, err) }
			read := func() AssistantThread {
				test.Helper()
				var value AssistantThread
				if err := app.db.First(&value, "id = ?", thread.ID).Error; err != nil { test.Fatal(err) }
				return value
			}
			assertStatus := func(id, status string) {
				test.Helper()
				var turn AssistantTurn
				if err := app.db.First(&turn, "id = ?", id).Error; err != nil || turn.Status != status { test.Fatalf("turn status = %s, want %s (%v)", turn.Status, status, err) }
			}
			start := func(message string) AssistantTurn {
				test.Helper()
				turn, err := app.StartAssistantTurn(user, thread.ID, assistantTurnInput{ChannelID: "channel", ModelID: "model", Version: read().Version, Prompt: message,
					Attachments: []string{"reference-image"}, Parameters: map[string]any{"systemPrompt": "conversation-only instruction", "reference": "reference-image"}})
				if err != nil { test.Fatal(err) }
				return turn
			}
			ctx := context.Background()
			if fixture.previous != "" {
				previous := start("不能把这条未完成请求当作标题。")
				if fixture.previous == "cancelled" {
					if err := app.CancelAssistantTurn(user.ID, previous.ID); err != nil { test.Fatal(err) }
				}
				app.executeAssistantWithText(ctx, previous.ID, func(_ context.Context, _ AssistantTurn, _ executionSnapshot, _ []map[string]any, _ map[string]any, _ []assetInput, tools []map[string]any, _ func(string, string) error) (providerResult, error) {
					if fixture.previous == "cancelled" || len(tools) == 0 { test.Fatal("an unsuccessful conversation attempted to generate a title") }
					return providerResult{Status: "failed", Error: "reply rejected"}, nil
				})
				assertStatus(previous.ID, fixture.previous)
			}
			before := read()
			turn := start(prompt)
			accepted := read()
			if accepted.Title != "" || accepted.Version != before.Version + 1 { test.Fatal("enqueue must leave the conversation unnamed", accepted) }
			if _, err := app.RenameAssistantThread("other", thread.ID, assistantRenameInput{Title: "不应修改", Version: accepted.Version}); !errors.Is(err, gorm.ErrRecordNotFound) { test.Fatalf("rename was not owner scoped: %v", err) }
			if _, err := app.RenameAssistantThread(user.ID, thread.ID, assistantRenameInput{Title: "旧版本", Version: before.Version}); err == nil { test.Fatal("stale rename was accepted") }
			calls := 0
			execution := ""
			expected := accepted
			expected.Title = shortTitle
			app.executeAssistantWithText(ctx, turn.ID, func(_ context.Context, running AssistantTurn, snapshot executionSnapshot, messages []map[string]any, parameters map[string]any, references []assetInput, tools []map[string]any, _ func(string, string) error) (providerResult, error) {
				calls++
				if running.ID != turn.ID { test.Fatal("naming created another turn") }
				if calls == 1 {
					if len(tools) == 0 || len(references) != 1 { test.Fatal("first call was not the normal conversation request") }
					execution = string(encode(snapshot))
					return providerResult{Status: "completed", Text: reply}, nil
				}
				if calls != 2 || string(encode(snapshot)) != execution || len(tools) != 0 || len(references) != 0 || parameters["reference"] != nil || parameters["systemPrompt"] != nil {
					test.Fatal("title request did not reuse the execution snapshot with isolated input")
				}
				if len(messages) != 2 || messages[0]["role"] != "system" || messages[1]["role"] != "user" || messages[1]["content"] != safePrompt { test.Fatal("title request included material other than the redacted initial request") }
				assertStatus(turn.ID, "succeeded")
				var saved AssistantItem
				if err := app.db.First(&saved, "turn_id = ? AND role = ?", turn.ID, "assistant").Error; err != nil || saved.Text != reply { test.Fatal("naming started before the reply was saved", err) }
				if fixture.rename {
					expected, err = app.RenameAssistantThread(user.ID, thread.ID, assistantRenameInput{Title: "手动定稿", Version: accepted.Version})
					if err != nil { test.Fatal(err) }
				}
				if fixture.failTitle {
					expected.Title = ""
					return providerResult{Text: modelTitle}, errors.New("title provider failed")
				}
				return providerResult{Status: "completed", Text: modelTitle, Usage: map[string]any{"output_tokens": 12}}, nil
			})
			assertStatus(turn.ID, "succeeded")
			if current := read(); calls != 2 || current.Title != expected.Title || current.Version != expected.Version || !current.UpdatedAt.Equal(expected.UpdatedAt) { test.Fatalf("title = %q after %d requests; version/timestamp or title did not match", current.Title, calls) }
			var entries []UsageEntry
			if err := app.db.Where("turn_id = ?", turn.ID).Order("id").Find(&entries).Error; err != nil || len(entries) != 2 || entries[1].ID != "turn:"+turn.ID+":title" || entries[1].ModelID != "model" || entries[1].ChannelID != "channel" { test.Fatal("naming was not counted separately for the same channel and model", err) }
			wantState := "actual"
			if fixture.failTitle { wantState = "unknown" }
			if entries[1].State != wantState { test.Fatalf("title use was marked %s, want %s", entries[1].State, wantState) }
			if fixture.failTitle {
				followup := start("改写第二个镜头。")
				app.executeAssistantWithText(ctx, followup.ID, func(_ context.Context, _ AssistantTurn, _ executionSnapshot, _ []map[string]any, _ map[string]any, _ []assetInput, tools []map[string]any, _ func(string, string) error) (providerResult, error) {
					if len(tools) == 0 { test.Fatal("failed title was retried on a later turn") }
					return providerResult{Status: "completed", Text: reply}, nil
				})
				assertStatus(followup.ID, "succeeded")
				if current := read(); current.Title != "" { test.Fatal("failed title was replaced by a fallback", current.Title) }
			}
		})
	}
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
