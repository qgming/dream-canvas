package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"
)

func TestManualTaskCancellationReleasesCleanupAndRetainsSavedResults(t *testing.T) {
	a := assetFileTestApp(t)
	if err := a.db.AutoMigrate(&UsageEntry{}); err != nil { t.Fatal(err) }
	started := time.Now().Add(-time.Hour)
	task := GenerationTask{ID: identifier(), UserID: "owner", Status: "confirmation_required", Capability: "image", AssetIDs: JSON(`[]`), Input: JSON(`{}`), Snapshot: JSON(`{}`), Result: encode(providerResult{Status: "confirmation_required"}), UsageState: "unknown", StartedAt: &started, Error: "missing upstream ID", CancelError: "pending", SaveState: "failed"}
	task.RawResponseFile = task.ID+".script.json"
	if err := a.db.Create(&task).Error; err != nil { t.Fatal(err) }
	input := Asset{ID: identifier(), UserID: "owner", Kind: "image", SaveState: "saved", DeleteState: "pending", Metadata: JSON(`{}`)}
	input.Path = input.ID+".png"
	output := Asset{ID: identifier(), UserID: "owner", Kind: "image", SaveState: "saved", Metadata: encode(map[string]any{"taskId": task.ID})}
	output.Path = output.ID+".png"
	for _, asset := range []Asset{input, output} {
		if err := a.db.Create(&asset).Error; err != nil { t.Fatal(err) }
		if err := a.db.Create(&TaskAsset{TaskID: task.ID, AssetID: asset.ID}).Error; err != nil { t.Fatal(err) }
		if err := os.WriteFile(filepath.Join(a.root, "assets", asset.Path), []byte("original"), 0600); err != nil { t.Fatal(err) }
	}
	next := time.Now().Add(time.Hour)
	operation := FileOperation{ID: identifier(), AssetID: input.ID, Kind: "delete", Attempts: 3, NextRunAt: &next, Error: "previous failure"}
	if err := a.db.Create(&operation).Error; err != nil { t.Fatal(err) }
	usage := UsageEntry{ID: "task:"+task.ID, UserID: "owner", TaskID: task.ID, State: "unknown", Usage: JSON(`{}`), StartedAt: started}
	if err := a.db.Create(&usage).Error; err != nil { t.Fatal(err) }
	if err := os.MkdirAll(filepath.Join(a.root, "results"), 0700); err != nil { t.Fatal(err) }
	evidence := []byte(`{"phase":"submit","response":{"task_id":"retained"}}`)
	if err := os.WriteFile(filepath.Join(a.root, "results", task.RawResponseFile), evidence, 0600); err != nil { t.Fatal(err) }
	if err := a.DeleteTask("owner", task.ID, taskActionInput{Confirmed: true, ExpectedUpdatedAt: task.UpdatedAt}); err == nil { t.Fatal("unresolved task could be deleted") }
	before := task
	resolved, err := a.ResolveTask("owner", task.ID, taskActionInput{Confirmed: true, ExpectedUpdatedAt: task.UpdatedAt, Status: "cancelled", Note: "checked by user"})
	if err != nil { t.Fatal(err) }
	if resolved.Status != "cancelled" || !resolved.CancelRequested || resolved.ResolvedAt == nil || resolved.ResolvedBy != "owner" || resolved.ResolutionNote != "checked by user" { t.Fatal("manual decision was not persisted") }
	if resolved.UsageState != "unknown" || !resolved.ResponseCleanupPending || resolved.RawResponseFile != before.RawResponseFile || !resolved.StartedAt.Equal(started) || string(resolved.Snapshot) != string(before.Snapshot) || string(resolved.Result) != string(before.Result) { t.Fatal("manual cancellation changed execution or usage evidence") }
	var ids []string
	if json.Unmarshal(resolved.AssetIDs, &ids) != nil || len(ids) != 1 || ids[0] != output.ID { t.Fatal("a partially saved output was lost") }
	var active int64
	if err := a.db.Model(&TaskAsset{}).Where("task_id = ? AND released = ?", task.ID, false).Count(&active).Error; err != nil { t.Fatal(err) }
	if active != 0 { t.Fatal("manual cancellation retained asset leases") }
	var savedOperation FileOperation
	if err := a.db.First(&savedOperation, "id = ?", operation.ID).Error; err != nil { t.Fatal(err) }
	if savedOperation.NextRunAt != nil || savedOperation.Attempts != 3 || savedOperation.Error != "previous failure" { t.Fatalf("pending cleanup was not resumed with its history intact: %+v", savedOperation) }
	var pending *Problem
	if err := a.cleanAsset(input.ID); !errors.As(err, &pending) || pending.Code != "response_cleanup_pending" { t.Fatal("global deletion bypassed response media copies") }
	a.cleanupTaskResponses(before)
	if _, err := os.Stat(filepath.Join(a.root, "results", task.RawResponseFile)); !errors.Is(err, os.ErrNotExist) { t.Fatal("terminal response media copies were not cleaned") }
	if err := a.db.AutoMigrate(&AssetReference{}); err != nil { t.Fatal(err) }
	if err := a.cleanAsset(input.ID); err != nil { t.Fatal(err) }
	if _, err := os.Stat(filepath.Join(a.root, "assets", input.Path)); !errors.Is(err, os.ErrNotExist) { t.Fatal("released pending original was not removed") }
	if _, err := os.Stat(filepath.Join(a.root, "assets", output.Path)); err != nil { t.Fatal("manual cancellation deleted an output") }
	var saved GenerationTask; if err := a.db.First(&saved, "id = ?", task.ID).Error; err != nil { t.Fatal(err) }
	if err := a.DeleteTask("owner", task.ID, taskActionInput{Confirmed: true, ExpectedUpdatedAt: saved.UpdatedAt}); err != nil { t.Fatal(err) }
	if err := a.DeleteTask("owner", task.ID, taskActionInput{Confirmed: true, ExpectedUpdatedAt: saved.UpdatedAt}); err != nil { t.Fatal("record removal was not idempotent") }
	if err := a.db.First(&usage, "id = ?", usage.ID).Error; err != nil { t.Fatal(err) }
	if usage.State != "unknown" || string(usage.Usage) != "{}" || !usage.StartedAt.Equal(started) { t.Fatal("record removal changed historical usage") }
	if _, err := a.ResumeTask("owner", task.ID); err == nil { t.Fatal("manually ended task could resume") }
	if err := a.db.First(&output, "id = ?", output.ID).Error; err != nil || output.DeleteState != "" { t.Fatal("record removal deleted its output asset") }
	router := assetFileTestRouter(a); router.GET("/api/tasks", a.listTasks); router.GET("/api/tasks/:id", a.getTask)
	for _, route := range []string{"/api/tasks", "/api/tasks?includeRemoved=true", "/api/tasks/"+task.ID} {
		response := httptest.NewRecorder(); router.ServeHTTP(response, httptest.NewRequest("GET", route, nil))
		if response.Code != 200 { t.Fatalf("task history returned %d", response.Code) }
		contains := strings.Contains(response.Body.String(), task.ID)
		if contains != (route != "/api/tasks") { t.Fatal("record deletion did not separate task listing from durable history") }
	}
}

func TestManualTaskResolutionRejectsUnsafeDecisions(t *testing.T) {
	a := assetFileTestApp(t)
	task := GenerationTask{ID: identifier(), UserID: "owner", Status: "confirmation_required", Capability: "image", AssetIDs: JSON(`[]`)}
	if err := a.db.Create(&task).Error; err != nil { t.Fatal(err) }
	request := taskActionInput{Confirmed: true, ExpectedUpdatedAt: task.UpdatedAt, Status: "cancelled"}
	if _, err := a.ResolveTask("other", task.ID, request); !errors.Is(err, gorm.ErrRecordNotFound) { t.Fatal("another user could resolve task") }
	for _, input := range []taskActionInput{
		{ExpectedUpdatedAt: task.UpdatedAt, Status: "cancelled"},
		{Confirmed: true, ExpectedUpdatedAt: task.UpdatedAt.Add(-time.Second), Status: "cancelled"},
		{Confirmed: true, ExpectedUpdatedAt: task.UpdatedAt, Status: "succeeded"},
		{Confirmed: true, ExpectedUpdatedAt: task.UpdatedAt, Status: "running"},
	} { if _, err := a.ResolveTask("owner", task.ID, input); err == nil { t.Fatal("unsafe decision was accepted") } }
	for _, key := range []string{"task:", "results:"} {
		a.active = map[string]context.CancelFunc{key+task.ID: func() {}}
		if _, err := a.ResolveTask("owner", task.ID, request); err == nil { t.Fatal("resolution raced active result work") }
	}
	a.active = nil
	if err := a.db.Model(&task).Update("status", "running").Error; err != nil { t.Fatal(err) }
	request.ExpectedUpdatedAt = task.UpdatedAt
	if _, err := a.ResolveTask("owner", task.ID, request); err == nil { t.Fatal("running task was falsely finalized") }
	if err := a.DeleteTask("owner", task.ID, request); err == nil { t.Fatal("running task record was removed") }
}

func TestTaskActionsShareHTTPAndMCPValidation(t *testing.T) {
	for _, entry := range []string{"http", "mcp"} {
		t.Run(entry, func(t *testing.T) {
			a := assetFileTestApp(t)
			task := GenerationTask{ID: identifier(), UserID: "owner", ProjectID: "project", NodeID: "node", Status: "confirmation_required", Capability: "text", AssetIDs: JSON(`[]`), Text: "saved output", SaveState: "saved", Error: "previous reason"}
			if err := a.db.Create(&task).Error; err != nil { t.Fatal(err) }
			// The referenced project was deleted. Manual confirmation still finishes
			// the task, records the unapplied result and releases its leases.
			if err := a.db.AutoMigrate(&Project{}); err != nil { t.Fatal(err) }
			principal := Principal{User: User{ID: "owner"}, Scopes: []string{"generate", "delete", "read"}, Projects: []string{"project"}}
			args := map[string]any{"taskId": task.ID, "expectedUpdatedAt": task.UpdatedAt, "confirmed": true, "status": "succeeded"}
			if entry == "http" {
				router := assetFileTestRouter(a); router.POST("/api/tasks/:id/resolve", a.resolveTask)
				response := httptest.NewRecorder(); router.ServeHTTP(response, httptest.NewRequest("POST", "/api/tasks/"+task.ID+"/resolve", strings.NewReader(string(encode(args)))))
				if response.Code != 200 { t.Fatalf("manual resolution returned %d: %s", response.Code, response.Body.String()) }
			} else {
				denied := principal; denied.Projects = []string{"other-project"}
				if _, err := a.CallBusiness(context.Background(), denied, "task_resolve", args); err == nil { t.Fatal("resolution escaped project scope") }
				denied = principal; denied.FixedProject, denied.TargetProjectID = true, "project"
				if _, err := a.CallBusiness(context.Background(), denied, "task_resolve", args); err == nil { t.Fatal("assistant could confirm a task outcome") }
				if _, err := a.CallBusiness(context.Background(), principal, "task_resolve", args); err != nil { t.Fatal(err) }
			}
			if err := a.db.First(&task, "id = ?", task.ID).Error; err != nil { t.Fatal(err) }
			if task.Status != "succeeded" || task.Text != "saved output" || task.ApplyError == "" || task.ResolutionNote != "previous reason" { t.Fatal("manual success lost its saved output or recovery evidence") }
			args["expectedUpdatedAt"] = task.UpdatedAt
			if entry == "http" {
				router := assetFileTestRouter(a); router.DELETE("/api/tasks/:id", a.deleteTask)
				response := httptest.NewRecorder(); router.ServeHTTP(response, httptest.NewRequest("DELETE", "/api/tasks/"+task.ID, strings.NewReader(string(encode(args)))))
				if response.Code != 200 { t.Fatalf("task deletion returned %d: %s", response.Code, response.Body.String()) }
			} else {
				denied := principal; denied.FixedProject, denied.TargetProjectID = true, "project"
				if _, err := a.CallBusiness(context.Background(), denied, "task_delete", args); err == nil { t.Fatal("assistant could delete a task record") }
				if _, err := a.CallBusiness(context.Background(), principal, "task_delete", args); err != nil { t.Fatal(err) }
				value, err := a.CallBusiness(context.Background(), principal, "tasks_list", map[string]any{}); if err != nil || len(value.([]GenerationTask)) != 0 { t.Fatal("MCP listed a deleted record") }
			}
			result, err := a.WaitTasks(principal, []string{task.ID}); if err != nil || !result.Ready || len(result.Tasks) != 1 { t.Fatal("task record deletion broke existing assistant wait references") }
		})
	}
}
