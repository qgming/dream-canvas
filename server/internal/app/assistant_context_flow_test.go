package app

import (
	"context"
	"strings"
	"testing"
)

func TestAssistantCompactsAfterResponseWithoutNewUserMessage(test *testing.T) {
	const request = "核对已有任务并告诉我结果"
	const summary = "已核对任务，结果已保存。"
	const continuation = "已有任务已核对。"
	const referenceID = "reference-image"
	large := strings.Repeat(" scene", assistantContextLimit+1)
	for _, fixture := range []struct {
		name            string
		toolResult      bool
		failSummary     bool
		wantModelCalls  int
		wantContext     string
	}{
		{name: "oversized completed tool resumes the same turn", toolResult: true, wantModelCalls: 3, wantContext: "completed"},
		{name: "oversized final answer compacts before finishing", wantModelCalls: 1, wantContext: "completed"},
		{name: "failed final compaction preserves the answer", failSummary: true, wantModelCalls: 1, wantContext: "failed"},
	} {
		test.Run(fixture.name, func(test *testing.T) {
			app := assetFileTestApp(test)
			if err := app.db.AutoMigrate(&AssistantThread{}, &AssistantTurn{}, &AssistantItem{}, &Channel{}, &UsageEntry{}); err != nil {
				test.Fatal(err)
			}
			thread := AssistantThread{ID: "thread", UserID: "owner"}
			turn := AssistantTurn{ID: "turn", ThreadID: thread.ID, UserID: thread.UserID, Status: "queued"}
			snapshot := assistantSnapshot{Execution: executionSnapshot{Policy: suggestedPolicy(), Model: ChannelModel{Capability: "text", Parameters: JSON(`[]`)}}}
			snapshot.appendMessage(0, map[string]any{"role": "system", "content": "agent"})
			userItem := AssistantItem{ID: "request", ThreadID: thread.ID, TurnID: turn.ID, UserID: turn.UserID, Role: "user", Sequence: 1, Text: request}
			content := any(request)
			if fixture.toolResult {
				content = []map[string]any{{"type": "text", "text": request}, {"type": "image_asset", "assetId": referenceID}}
				snapshot.Media = []assetInput{{AssetID: referenceID, Role: "image"}}
				userItem.Detail = encode(map[string]any{"attachments": []string{referenceID}})
			}
			snapshot.appendMessage(userItem.Sequence, map[string]any{"role": "user", "content": content})
			turn.Snapshot = encode(snapshot)
			for _, row := range []any{&thread, &turn, &userItem} {
				if err := app.db.Create(row).Error; err != nil { test.Fatal(err) }
			}
			if fixture.toolResult {
				for _, row := range []any{&GenerationTask{ID: "saved-task", UserID: thread.UserID, Status: "succeeded", Text: large}, &TaskAsset{TaskID: "turn:"+turn.ID, AssetID: referenceID}} {
					if err := app.db.Create(row).Error; err != nil { test.Fatal(err) }
				}
			}

			modelCalls, summaryCalls := 0, 0
			summarizedResult := false
			callText := func(_ context.Context, running AssistantTurn, _ executionSnapshot, messages []map[string]any, _ map[string]any, references []assetInput, tools []map[string]any, _ func(string, string) error) (providerResult, error) {
				test.Helper()
				var stored AssistantTurn
				if err := app.db.First(&stored, "id = ?", running.ID).Error; err != nil || stored.ID != turn.ID || stored.Status != "running" {
					test.Fatalf("call must belong to the original active turn, got %s (%v)", stored.Status, err)
				}
				if len(tools) == 0 {
					summaryCalls++
					var activity AssistantItem
					if err := app.db.First(&activity, "turn_id = ? AND role = ?", turn.ID, assistantContextStatusRole).Error; err != nil || objectFromJSON(activity.Detail)["status"] != "running" {
						test.Fatalf("missing live context activity: %v", err)
					}
					var completed AssistantItem
					response := app.db.Where("turn_id = ? AND role = ?", turn.ID, "assistant")
					if fixture.toolResult { response = app.db.Where("turn_id = ? AND id = ?", turn.ID, "list-tasks") }
					if err := response.First(&completed).Error; err != nil || completed.Sequence >= activity.Sequence || !strings.Contains(completed.Text, large) {
						test.Fatalf("context compaction started before the full response was saved: %v", err)
					}
					if fixture.toolResult && objectFromJSON(completed.Detail)["status"] != "completed" { test.Fatal("compaction ran before the tool exchange completed") }
					marker := " scene scene"
					if fixture.toolResult { marker = "saved-task" }
					for _, message := range messages { if strings.Contains(text(message["content"]), marker) { summarizedResult = true } }
					if fixture.failSummary { return providerResult{Status: "failed"}, nil }
					return providerResult{Status: "completed", Text: summary}, nil
				}
				modelCalls++
				tasksAvailable := false
				for _, tool := range tools { if assistantToolName(tool) == "tasks_list" { tasksAvailable = true; break } }
				if modelCalls == 1 {
					if !fixture.toolResult { return providerResult{Status: "completed", Text: large}, nil }
					if tasksAvailable { test.Fatal("tasks supplied before discovery") }
					return providerResult{Status: "completed", ToolCalls: []map[string]any{{
						"id": "load-generation", "type": "function", "function": map[string]any{"name": assistantLoadToolsName, "arguments": `{"group":"generation"}`},
					}}}, nil
				}
				if fixture.toolResult && modelCalls == 2 {
					if !tasksAvailable { test.Fatal("tasks not supplied after discovery") }
					return providerResult{Status: "completed", ToolCalls: []map[string]any{{
						"id": "list-tasks", "type": "function", "function": map[string]any{"name": "tasks_list", "arguments": `{}`},
					}}}, nil
				}
				if !fixture.toolResult || modelCalls != 3 || summaryCalls == 0 || !tasksAvailable { test.Fatal("unexpected continuation request or lost tool group after compaction") }
				original, compacted := false, false
				for _, message := range messages {
					if message["role"] == "tool" || len(array(message["tool_calls"])) != 0 { test.Fatal("compaction retained an oversized or incomplete tool exchange") }
					if message["role"] == "user" && string(encode(message["content"])) == string(encode(content)) { original = true }
					if strings.Contains(text(message["content"]), summary) { compacted = true }
				}
				if !original || !compacted || assistantContextTokenCount(messages) >= assistantContextLimit { test.Fatal("continuation did not receive the compacted context and original request") }
				var lease TaskAsset
				if err := app.db.First(&lease, "task_id = ? AND asset_id = ?", "turn:"+turn.ID, referenceID).Error; err != nil || lease.Released || len(references) != 1 || references[0].AssetID != referenceID { test.Fatal("continuation lost its attachment or asset lease", err) }
				return providerResult{Status: "completed", Text: continuation}, nil
			}
			app.executeAssistantWithText(context.Background(), turn.ID, callText)

			var finished AssistantTurn
			if err := app.db.First(&finished, "id = ?", turn.ID).Error; err != nil || finished.Status != "succeeded" || modelCalls != fixture.wantModelCalls || summaryCalls == 0 {
				test.Fatalf("unexpected completion: %s (%v), %d model calls, %d summary calls", finished.Status, err, modelCalls, summaryCalls)
			}
			if !summarizedResult { test.Fatal("compaction did not receive the oversized response") }
			var items []AssistantItem
			if err := app.db.Where("thread_id = ? AND role <> ?", thread.ID, assistantContextUsageRole).Order("sequence").Find(&items).Error; err != nil { test.Fatal(err) }
			roles := []string{"user", "assistant", assistantContextStatusRole}
			contextIndex := 2
			if fixture.toolResult { roles = []string{"user", "assistant", "tool", "assistant", "tool", assistantContextStatusRole, "assistant"}; contextIndex = 5 }
			if len(items) != len(roles) { test.Fatalf("got %d timeline entries, want %d", len(items), len(roles)) }
			for index, item := range items {
				if item.Role != roles[index] || item.TurnID != turn.ID { test.Fatalf("unexpected timeline entry %d: %s", index, item.Role) }
			}
			if objectFromJSON(items[contextIndex].Detail)["status"] != fixture.wantContext { test.Fatalf("unexpected context activity: %s", items[contextIndex].Detail) }
			if fixture.toolResult && (items[2].ID != "load-generation" || items[4].ID != "list-tasks" || items[6].Text != continuation) { test.Fatal("tool result was replayed or no continuation was saved") }
			if !fixture.toolResult && items[1].Text != large { test.Fatal("completed answer was altered by compaction") }
			checkpoint, err := app.latestAssistantContext(thread)
			if err != nil { test.Fatal(err) }
			if !fixture.failSummary && (checkpoint == nil || checkpoint.RetainedUserSequence != userItem.Sequence) { test.Fatal("the original request was not retained in the persisted checkpoint") }
			if fixture.failSummary && checkpoint != nil { test.Fatal("failed compaction published a checkpoint") }
		})
	}
}
