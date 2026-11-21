package app

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestAssistantFinalTimeoutKeepsToolsAndDoesNotBookUnsubmittedCall(t *testing.T) {
	a := assetFileTestApp(t)
	if err := a.db.AutoMigrate(&AssistantTurn{}, &AssistantItem{}, &UsageEntry{}, &Channel{}, &ClientCommand{}); err != nil {
		t.Fatal(err)
	}
	snapshot := assistantSnapshot{Execution: executionSnapshot{
		Policy: suggestedPolicy(), Model: ChannelModel{Parameters: JSON(`[]`), Capability: "text"},
		Script: &ScriptVersion{Scripts: JSON(`{"submit":"while (true) {}"}`)},
	}, Parameters: map[string]any{}}
	snapshot.Execution.Policy.ScriptRuntime[scriptSubmitSeconds] = 1
	turn := AssistantTurn{ID: "turn-timeout", ThreadID: "thread", UserID: "owner", Step: 1, Status: "queued", Snapshot: encode(snapshot)}
	lease := TaskAsset{TaskID: "turn:" + turn.ID, AssetID: "attachment"}
	knownTool := AssistantItem{ThreadID: turn.ThreadID, TurnID: turn.ID, UserID: turn.UserID, ID: "tool-call", Role: "tool", Sequence: 1,
		Text: `{"id":"saved-project"}`, Detail: JSON(`{"kind":"tool","name":"project_create","status":"completed"}`)}
	for _, entry := range []any{&turn, &lease, &knownTool, &UsageEntry{ID: "turn:" + turn.ID + ":0", TurnID: turn.ID, UserID: turn.UserID, State: "actual", StartedAt: time.Now()}} {
		if err := a.db.Create(entry).Error; err != nil {
			t.Fatal(err)
		}
	}
	ctx := context.Background()
	a.executeAssistant(ctx, turn.ID)
	if err := a.CancelAssistantTurn(turn.UserID, turn.ID); err != nil {
		t.Fatal(err)
	}
	if err := a.recoverExecution(); err != nil {
		t.Fatal(err)
	}
	a.repairAssistantUsage()
	a.executeAssistant(ctx, turn.ID) // A finished partial reply is not dispatchable.
	var finished AssistantTurn
	if err := a.db.First(&finished, "id = ?", turn.ID).Error; err != nil {
		t.Fatal(err)
	}
	if finished.Status != "partial" || !strings.Contains(finished.Error, "模型请求准备超时") || !strings.Contains(finished.Error, "尚未提交供应商") {
		t.Fatalf("expected partial reply with pre-submit diagnosis: %+v", finished)
	}
	var items []AssistantItem
	if err := a.db.Where("turn_id = ?", turn.ID).Order("sequence").Find(&items).Error; err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 || items[0].Text != knownTool.Text || objectFromJSON(items[1].Detail)["usageUnsubmitted"] != true || objectFromJSON(items[1].Detail)["usageRecordPending"] != false {
		t.Fatalf("tools or unsubmitted call were not preserved correctly: %+v", items)
	}
	var entries []UsageEntry
	if err := a.db.Where("turn_id = ?", turn.ID).Find(&entries).Error; err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].ID != "turn:"+turn.ID+":0" {
		t.Fatalf("usage was lost or a call was booked twice: %+v", entries)
	}
	if err := a.db.First(&lease, "task_id = ? AND asset_id = ?", lease.TaskID, lease.AssetID).Error; err != nil || !lease.Released {
		t.Fatalf("assistant lease not released: %v", err)
	}
}

func TestAssistantTimeoutDoesNotImplyUnconfirmedToolsSucceeded(t *testing.T) {
	a := assetFileTestApp(t)
	if err := a.db.AutoMigrate(&AssistantTurn{}, &AssistantItem{}); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name      string
		statuses  []string
		cancelled bool
		want      string
	}{
		{"only failed", []string{"failed"}, false, "interrupted"},
		{"tool outcome unknown", []string{"completed", "interrupted"}, false, "interrupted"},
		{"explicit stop", []string{"completed"}, true, "cancelled"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			turn := AssistantTurn{ID: identifier(), ThreadID: "thread", UserID: "owner", Step: 1, Status: "running", CancelRequested: tc.cancelled}
			if err := a.db.Create(&turn).Error; err != nil {
				t.Fatal(err)
			}
			for _, status := range tc.statuses {
				item := AssistantItem{ThreadID: turn.ThreadID, TurnID: turn.ID, ID: identifier(), UserID: turn.UserID, Role: "tool", Detail: encode(map[string]string{"status": status})}
				if err := a.db.Create(&item).Error; err != nil {
					t.Fatal(err)
				}
			}
			a.finishAssistantCallFailure(context.Background(), turn, &providerTimeoutError{stage: "provider_idle", cause: context.DeadlineExceeded})
			if err := a.db.First(&turn, "id = ?", turn.ID).Error; err != nil {
				t.Fatal(err)
			}
			if turn.Status != tc.want {
				t.Fatalf("got %s, want %s", turn.Status, tc.want)
			}
		})
	}
}
