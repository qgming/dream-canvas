package app

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"gorm.io/gorm"
)

func TestAssistantQuestionSurvivesRestartAndResumesSameTurn(test *testing.T) {
	app := assetFileTestApp(test)
	if err := app.db.AutoMigrate(&AssistantThread{}, &AssistantTurn{}, &AssistantItem{}, &ClientCommand{}, &Channel{}); err != nil { test.Fatal(err) }
	thread := AssistantThread{ID: "thread", UserID: "owner", Version: 2}
	turn := AssistantTurn{ID: "turn", ThreadID: thread.ID, UserID: thread.UserID, ProjectID: "fixed-project", Status: assistantWaitingUser, Step: 2}
	snapshot := assistantSnapshot{WaitingQuestionID: "question", Messages: []map[string]any{
		{"role": "assistant", "tool_calls": []map[string]any{{"id": "question", "type": "function", "function": map[string]any{"name": "ask_user", "arguments": `{"question":"选择比例？"}`}}}},
		{"role": "tool", "tool_call_id": "question", "content": `{"status":"waiting"}`},
	}}
	turn.Snapshot = encode(snapshot)
	question := AssistantItem{ID: "question", ThreadID: thread.ID, TurnID: turn.ID, UserID: thread.UserID, Sequence: 1, Role: "tool", Detail: JSON(`{"kind":"question","status":"waiting","question":"选择比例？","options":["16:9","9:16"]}`)}
	for _, row := range []any{&thread, &turn, &question} { if err := app.db.Create(row).Error; err != nil { test.Fatal(err) } }
	if err := app.recoverExecution(); err != nil { test.Fatal(err) }
	if err := app.DeleteAssistantThread(thread.UserID, thread.ID); err == nil { test.Fatal("waiting thread was deleted") }
	view, err := app.GetAssistantThread(thread.UserID, thread.ID)
	if err != nil || objectFromJSON(view["items"].([]AssistantItem)[0].Detail)["status"] != "waiting" { test.Fatal("question did not survive restart", err) }
	input := assistantAnswerInput{QuestionID: question.ID, Answer: " 16:9 "}
	if _, err := app.AnswerAssistantTurn(User{ID: "other"}, turn.ID, input); !errors.Is(err, gorm.ErrRecordNotFound) { test.Fatal("question is not owner scoped", err) }
	assertChanged := func(err error) {
		test.Helper()
		var detail *Problem
		if !errors.As(err, &detail) || detail.Code != "assistant_question_changed" { test.Fatalf("expected a stale question conflict, got %v", err) }
	}
	_, err = app.AnswerAssistantTurn(User{ID: thread.UserID}, turn.ID, assistantAnswerInput{QuestionID: "stale", Answer: "16:9"})
	assertChanged(err)
	resumed, err := app.AnswerAssistantTurn(User{ID: thread.UserID}, turn.ID, input)
	if err != nil || resumed.ID != turn.ID || resumed.ProjectID != turn.ProjectID || resumed.Step != turn.Step || resumed.Status != "queued" { test.Fatalf("answer did not resume the original turn: %+v, %v", resumed, err) }
	var resumedSnapshot assistantSnapshot
	if err := json.Unmarshal(resumed.Snapshot, &resumedSnapshot); err != nil { test.Fatal(err) }
	if resumedSnapshot.WaitingQuestionID != "" || len(resumedSnapshot.Messages) != 2 || objectFromJSON(JSON(text(resumedSnapshot.Messages[1]["content"])))["answer"] != "16:9" { test.Fatal("tool result was not updated in place") }
	view, err = app.GetAssistantThread(thread.UserID, thread.ID)
	if err != nil { test.Fatal(err) }
	detail := objectFromJSON(view["items"].([]AssistantItem)[0].Detail)
	if detail["status"] != "answered" || detail["answer"] != "16:9" { test.Fatal("answer was not visible in the original question") }
	_, err = app.AnswerAssistantTurn(User{ID: thread.UserID}, turn.ID, input)
	assertChanged(err)
}

func TestAssistantTodosValidateIDsAndStates(test *testing.T) {
	parse := func(raw string) ([]assistantTodo, error) { return parseAssistantTodos(objectFromJSON(JSON(raw))) }
	todos, err := parse(`{"todos":[{"id":" draft ","text":" 整理分镜 ","status":"in_progress"},{"id":"save","text":"保存素材","status":"pending"}]}`)
	if err != nil || len(todos) != 2 || todos[0].ID != "draft" || todos[0].Text != "整理分镜" { test.Fatal(todos, err) }
	for _, raw := range []string{
		`{"todos":[]}`,
		`{"todos":[{"id":"draft","text":"分镜","status":"unknown"}]}`,
		`{"todos":[{"id":"draft","text":"分镜","status":"completed"},{"id":" draft ","text":"保存","status":"pending"}]}`,
	} { if _, err := parse(raw); err == nil { test.Fatal("invalid checklist accepted", raw) } }
}

func TestAssistantContextCutDoesNotSplitLatestToolExchange(test *testing.T) {
	long := strings.Repeat(" scene", assistantContextLimit)
	snapshot := assistantSnapshot{}
	for index, message := range []map[string]any{
		{"role": "system", "content": "agent"},
		{"role": "user", "content": "旧任务"},
		{"role": "assistant", "content": long},
		{"role": "user", "content": "新任务"},
		{"role": "assistant", "tool_calls": []map[string]any{{"id": "recent", "function": map[string]any{"name": "project_get", "arguments": `{}`}}}},
		{"role": "tool", "tool_call_id": "recent", "content": `{"id":"saved-project"}`},
	} { snapshot.appendMessage(uint64(index), message) }
	tokens := assistantContextCost(snapshot, snapshot.Messages, nil)
	if tokens < assistantContextLimit { test.Fatalf("test input did not reach threshold: %d", tokens) }
	cut, checkpoint, err := assistantContextCut(snapshot, nil, assistantContextLimit, 16<<20)
	if err != nil || cut != 3 || checkpoint.Until != 2 { test.Fatalf("unexpected history boundary %d, %+v, %v", cut, checkpoint, err) }
	snapshot.Messages[5]["content"] = long
	snapshot.appendMessage(0, map[string]any{"role": "system", "content": "本轮目标项目已固定"})
	cut, checkpoint, err = assistantContextCut(snapshot, nil, assistantContextLimit, 16<<20)
	if err != nil || cut != 6 || checkpoint.Until != 5 || checkpoint.RetainedUserSequence != 3 { test.Fatalf("expected to summarize the complete oversized exchange and retain the request and trailing notice: %d, %+v, %v", cut, checkpoint, err) }
	unanswered := snapshot; unanswered.WaitingQuestionID = "recent"
	if _, _, err := assistantContextCut(unanswered, nil, assistantContextLimit, 16<<20); err == nil { test.Fatal("compaction must not summarize an unanswered question") }
	unfinished := snapshot; unfinished.Messages, unfinished.MessageSequences = unfinished.Messages[:5], unfinished.MessageSequences[:5]
	unfinished.Messages = append([]map[string]any{}, unfinished.Messages...)
	unfinished.Messages[4] = map[string]any{"role": "assistant", "content": long, "tool_calls": snapshot.Messages[4]["tool_calls"]}
	if _, _, err := assistantContextCut(unfinished, nil, assistantContextLimit, 16<<20); err == nil { test.Fatal("compaction must not summarize a dangling tool call") }
	snapshot.Messages[3]["content"] = long
	if _, _, err := assistantContextCut(snapshot, nil, assistantContextLimit, 16<<20); err == nil { test.Fatal("compaction must not drop an oversized active request") }
}

func TestAssistantContextFailureKeepsLastCheckpointAndHistoryPrivate(test *testing.T) {
	app := assetFileTestApp(test)
	if err := app.db.AutoMigrate(&AssistantThread{}, &AssistantTurn{}, &AssistantItem{}, &Channel{}); err != nil { test.Fatal(err) }
	thread := AssistantThread{ID: "thread", UserID: "owner"}
	turn := AssistantTurn{ID: "turn", ThreadID: thread.ID, UserID: thread.UserID, Status: "running"}
	snapshot := assistantSnapshot{Execution: executionSnapshot{Policy: suggestedPolicy(), Model: ChannelModel{Parameters: JSON(`[]`)}}}
	snapshot.appendMessage(0, map[string]any{"role": "system", "content": "agent"})
	snapshot.appendMessage(3, map[string]any{"role": "user", "content": strings.Repeat(" scene", assistantContextLimit)})
	snapshot.appendMessage(4, map[string]any{"role": "user", "content": "continue"})
	turn.Snapshot = encode(snapshot)
	for _, row := range []any{&thread, &turn,
		&AssistantItem{ID: "old", ThreadID: thread.ID, TurnID: turn.ID, UserID: thread.UserID, Role: "user", Sequence: 1, Text: "untouched history"},
		&AssistantItem{ID: "checkpoint", ThreadID: thread.ID, TurnID: turn.ID, UserID: thread.UserID, Role: assistantContextStatusRole, Sequence: 2, Text: "private summary", Detail: JSON(`{"kind":"context","status":"completed","until":1}`)},
	} { if err := app.db.Create(row).Error; err != nil { test.Fatal(err) } }
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := app.prepareAssistantContext(ctx, turn, &snapshot, nil, app.callText); !errors.Is(err, context.Canceled) { test.Fatal("expected compaction to stop without a model call", err) }
	checkpoint, err := app.latestAssistantContext(thread)
	if err != nil || checkpoint == nil || checkpoint.Until != 1 || checkpoint.Summary != "private summary" { test.Fatalf("failed compaction replaced a good checkpoint: %+v, %v", checkpoint, err) }
	view, err := app.GetAssistantThread(thread.UserID, thread.ID)
	if err != nil { test.Fatal(err) }
	items := view["items"].([]AssistantItem)
	if items[0].Text != "untouched history" || items[1].Text != "" || strings.Contains(string(encode(items)), "private summary") { test.Fatal("history changed or private summary leaked") }
}
