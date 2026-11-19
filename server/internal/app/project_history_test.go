package app

import (
	"encoding/json"
	"path/filepath"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func historyTestApp(t *testing.T) *App {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "canvas.sqlite")), &gorm.Config{}); if err != nil { t.Fatal(err) }
	if err := db.AutoMigrate(&Project{}, &ProjectRevision{}, &GenerationTask{}, &Asset{}, &AssetReference{}, &FileOperation{}, &CanvasPluginRecord{}, &CanvasPluginDraft{}, &CanvasPluginVersion{}); err != nil { t.Fatal(err) }
	connection, err := db.DB(); if err != nil { t.Fatal(err) }; t.Cleanup(func() { connection.Close() })
	a := &App{db: db, events: map[string]map[chan string]bool{}}
	if err := a.installBuiltinCanvasPlugins(); err != nil { t.Fatal(err) }
	return a
}

func historyDocument() JSON {
	return JSON(`{"nodes":[{"id":"a","type":"text","title":"A","position":{"x":0,"y":0},"width":100,"height":100,"metadata":{"content":"base","status":"success"}}],"connections":[],"viewport":{"x":0,"y":0,"k":1}}`)
}

func editHistoryNode(t *testing.T, document JSON, edit func(map[string]any)) JSON {
	t.Helper(); var value map[string]any; if err := json.Unmarshal(document, &value); err != nil { t.Fatal(err) }; edit(object(array(value["nodes"])[0])); return encode(value)
}

func TestCanvasConcurrentSaveAndDurableUndo(t *testing.T) {
	a := historyTestApp(t)
	base, err := a.CreateProject("user", projectInput{Title: "Canvas", Document: historyDocument()}); if err != nil { t.Fatal(err) }
	moved := editHistoryNode(t, base.Document, func(node map[string]any) { object(node["position"])["x"] = 40 })
	if _, err := a.SaveProject("user", base.ID, projectInput{Title: base.Title, Version: base.Version, Document: moved}); err != nil { t.Fatal(err) }
	text := editHistoryNode(t, base.Document, func(node map[string]any) { object(node["metadata"])["content"] = "assistant" })
	saved, err := a.SaveProject("user", base.ID, projectInput{Title: base.Title, Version: base.Version, Document: text}); if err != nil { t.Fatal(err) }
	var value map[string]any; _ = json.Unmarshal(saved.Document, &value); node := object(array(value["nodes"])[0])
	if object(node["position"])["x"] != float64(40) || object(node["metadata"])["content"] != "assistant" { t.Fatal("concurrent move or text lost") }
	history, err := a.ProjectHistory(saved); if err != nil || len(history.Past) != 2 { t.Fatalf("history: %+v %v", history, err) }
	undone, err := a.RevertProject("user", saved.ID, saved.Version, saved.Version); if err != nil { t.Fatal(err) }
	_ = json.Unmarshal(undone.Document, &value); node = object(array(value["nodes"])[0])
	if object(node["position"])["x"] != float64(40) || object(node["metadata"])["content"] != "base" { t.Fatal("undo overwrote unrelated move") }
	// Read stacks from the database again, as a refreshed page or restarted service does.
	history, err = a.ProjectHistory(undone); if err != nil || len(history.Past) != 1 || len(history.Future) != 1 { t.Fatalf("undo history: %+v %v", history, err) }
	redone, err := a.RevertProject("user", saved.ID, undone.Version, history.Future[0]); if err != nil { t.Fatal(err) }
	_ = json.Unmarshal(redone.Document, &value); if object(object(array(value["nodes"])[0])["metadata"])["content"] != "assistant" { t.Fatal("redo lost text") }
}

func TestCanvasMergeRejectsEditingDeletedTarget(t *testing.T) {
	base := Project{Title: "Canvas", Document: historyDocument()}
	edited := base; edited.Document = editHistoryNode(t, base.Document, func(node map[string]any) { node["title"] = "changed" })
	current := base; current.Document = JSON(`{"nodes":[],"connections":[],"viewport":{"x":0,"y":0,"k":1}}`)
	if _, err := mergeProject(base, edited, current); err == nil { t.Fatal("deleted node was resurrected") }
}

func TestCanvasUndoKeepsViewportAndSkipsViewportOnlyHistory(t *testing.T) {
	a := historyTestApp(t)
	base, err := a.CreateProject("user", projectInput{Title: "Canvas", Document: historyDocument()}); if err != nil { t.Fatal(err) }
	var document map[string]any; _ = json.Unmarshal(base.Document, &document)
	object(document["viewport"])["x"] = 50; object(object(array(document["nodes"])[0])["metadata"])["content"] = "edited"
	edited, err := a.SaveProject("user", base.ID, projectInput{Title: base.Title, Version: base.Version, Document: encode(document)}); if err != nil { t.Fatal(err) }
	object(document["viewport"])["x"] = 90
	panned, err := a.SaveProject("user", base.ID, projectInput{Title: base.Title, Version: edited.Version, Document: encode(document)}); if err != nil { t.Fatal(err) }
	history, err := a.ProjectHistory(panned); if err != nil || len(history.Past) != 1 { t.Fatalf("viewport consumed an undo step: %+v %v", history, err) }
	undone, err := a.RevertProject("user", base.ID, panned.Version, edited.Version); if err != nil { t.Fatal(err) }
	_ = json.Unmarshal(undone.Document, &document)
	if object(document["viewport"])["x"] != float64(90) || object(object(array(document["nodes"])[0])["metadata"])["content"] != "base" { t.Fatal("undo lost viewport or failed to revert content") }
}

func TestCanvasDragSavesContinuouslyAndUndoesAsOneOperation(t *testing.T) {
	a := historyTestApp(t)
	base, err := a.CreateProject("user", projectInput{Title: "Canvas", Document: historyDocument()}); if err != nil { t.Fatal(err) }
	current := base
	for _, x := range []float64{10, 30, 80} {
		document := editHistoryNode(t, current.Document, func(node map[string]any) { object(node["position"])["x"] = x })
		current, err = a.SaveProject("user", base.ID, projectInput{Title: base.Title, Version: current.Version, Document: document, OperationID: "drag"}); if err != nil { t.Fatal(err) }
	}
	history, err := a.ProjectHistory(current); if err != nil || len(history.Past) != 1 { t.Fatalf("drag split undo history: %+v %v", history, err) }
	undone, err := a.RevertProject("user", base.ID, current.Version, current.Version); if err != nil { t.Fatal(err) }
	var document map[string]any; _ = json.Unmarshal(undone.Document, &document)
	if object(object(array(document["nodes"])[0])["position"])["x"] != float64(0) { t.Fatal("undo only reverted the last drag frame") }
	redone, err := a.RevertProject("user", base.ID, undone.Version, undone.Version); if err != nil { t.Fatal(err) }
	_ = json.Unmarshal(redone.Document, &document)
	if object(object(array(document["nodes"])[0])["position"])["x"] != float64(80) { t.Fatal("redo did not restore the full drag") }
}

func TestTaskResultAllowsMovesAndRejectsReplacedContent(t *testing.T) {
	var value map[string]any; _ = json.Unmarshal(historyDocument(), &value); target := object(array(value["nodes"])[0])
	var current map[string]any; _ = json.Unmarshal(encode(target), &current)
	object(current["position"])["x"] = 90; current["title"] = "renamed"
	input := generationInput{Capability: "image"}
	if err := taskTargetWritable(current, target, input); err != nil { t.Fatal(err) }
	object(current["metadata"])["content"] = "replaced"
	if err := taskTargetWritable(current, target, input); err == nil { t.Fatal("result replaced user content") }
}

func TestImageTaskWritesResultAfterConcurrentCanvasEdit(t *testing.T) {
	a := historyTestApp(t)
	document := JSON(`{"nodes":[{"id":"a","type":"image","title":"Image","position":{"x":0,"y":0},"width":100,"height":100,"metadata":{"status":"loading","images":[{"id":"slot","content":"","status":"loading"}]}},{"id":"b","type":"text","title":"Text","position":{"x":0,"y":0},"width":100,"height":100,"metadata":{"content":"keep"}}],"connections":[]}`)
	project, err := a.CreateProject("user", projectInput{Title: "Canvas", Document: document}); if err != nil { t.Fatal(err) }
	var value map[string]any; _ = json.Unmarshal(document, &value)
	task := GenerationTask{ID: "task", UserID: "user", ProjectID: project.ID, NodeID: "a", ProjectVersion: project.Version, ChannelID: "channel", Capability: "image", Status: "saving", TargetNode: encode(array(value["nodes"])[0]), Input: encode(generationInput{Capability: "image", Parameters: JSON(`{}`), ResultSlotID: "slot"}), Snapshot: encode(executionSnapshot{Model: ChannelModel{Model: "image-model", Parameters: JSON(`[]`)}})}
	if err := a.db.Create(&task).Error; err != nil { t.Fatal(err) }
	if err := a.db.Create(&Asset{ID: "image", UserID: "user", Kind: "image", SaveState: "saved", Width: 400, Height: 200, MimeType: "image/png"}).Error; err != nil { t.Fatal(err) }
	object(object(array(value["nodes"])[0])["position"])["x"] = 55
	object(object(array(value["nodes"])[1])["metadata"])["content"] = "assistant edit"
	if _, err := a.SaveProject("user", project.ID, projectInput{Title: project.Title, Version: project.Version, Document: encode(value)}); err != nil { t.Fatal(err) }
	if err := a.applyTaskResult(task, []string{"image"}, ""); err != nil { t.Fatal(err) }
	saved, err := a.GetProject("user", project.ID); if err != nil { t.Fatal(err) }; _ = json.Unmarshal(saved.Document, &value)
	image := object(array(value["nodes"])[0]); metadata := object(image["metadata"])
	if metadata["content"] != "/api/assets/image/file" || metadata["status"] != "success" { t.Fatal("image not applied") }
	if object(image["position"])["x"] != float64(55) || object(image["position"])["y"] != float64(25) { t.Fatal("task lost the moved node center") }
	if object(object(array(value["nodes"])[1])["metadata"])["content"] != "assistant edit" { t.Fatal("task overwrote another node") }
	if err := a.db.First(&task, "id = ?", task.ID).Error; err != nil { t.Fatal(err) }; if !task.Applied || task.AppliedVersion != saved.Version { t.Fatal("applied version was not persisted") }
	if err := a.applyTaskResult(task, []string{"image"}, ""); err != nil { t.Fatal(err) }
	again, _ := a.GetProject("user", project.ID); if again.Version != saved.Version { t.Fatal("duplicate completion created a second write") }
	if err := a.db.Model(&GenerationTask{}).Where("id = ?", task.ID).Update("status", "succeeded").Error; err != nil { t.Fatal(err) }
	undone, err := a.RevertProject("user", project.ID, saved.Version, saved.Version); if err != nil { t.Fatal(err) }; _ = json.Unmarshal(undone.Document, &value)
	if object(object(array(value["nodes"])[0])["metadata"])["status"] == "loading" { t.Fatal("undo restored a permanent loading indicator for a finished task") }
}

func TestImageTaskSiblingSubmissionAcceptsCompletedOtherSlot(t *testing.T) {
	a := historyTestApp(t)
	document := JSON(`{"nodes":[{"id":"a","type":"image","title":"Image","position":{"x":0,"y":0},"width":100,"height":100,"metadata":{"status":"loading","images":[{"id":"one","content":"","status":"loading"},{"id":"two","content":"","status":"loading"}]}}],"connections":[]}`)
	base, err := a.CreateProject("user", projectInput{Title: "Canvas", Document: document}); if err != nil { t.Fatal(err) }
	var value map[string]any; _ = json.Unmarshal(document, &value)
	metadata := object(object(array(value["nodes"])[0])["metadata"])
	metadata["generationMode"], metadata["modelParameters"] = "image", map[string]any{"model": map[string]any{"size": "1024x1024"}}
	object(array(metadata["images"])[0])["content"] = "/api/assets/image/file"
	// Validate a completed sibling snapshot without calling a provider or saving assets.
	current := base; current.Version++; current.Document = encode(value)
	if err := checkTaskTargetVersion(a.db, current, generationInput{Capability: "image", NodeID: "a", ProjectVersion: base.Version, ResultSlotID: "two"}, encode(array(value["nodes"])[0])); err != nil { t.Fatal(err) }
	if err := checkTaskTargetVersion(a.db, current, generationInput{Capability: "image", NodeID: "a", ProjectVersion: base.Version, ResultSlotID: "one"}, encode(array(value["nodes"])[0])); err == nil { t.Fatal("completed slot can be replaced by an older submission") }
}
