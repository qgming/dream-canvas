package app

import (
	"encoding/json"
	"testing"
)

func TestTaskRetainsAllVideoAndAudioResults(t *testing.T) {
	for _, capability := range []string{"video", "audio"} {
		t.Run(capability, func(t *testing.T) {
			application := historyTestApp(t)
			document := encode(map[string]any{"nodes": []any{map[string]any{"id": "media", "type": capability, "title": "Media", "position": map[string]any{"x": 20, "y": 40}, "width": 320, "height": 180, "metadata": map[string]any{"status": "loading", "prompt": "Keep this prompt"}}}, "connections": []any{}})
			project, err := application.CreateProject("user", projectInput{Title: "Canvas", Document: document})
			if err != nil { t.Fatal(err) }
			var value map[string]any
			if err := json.Unmarshal(document, &value); err != nil { t.Fatal(err) }
			task := GenerationTask{ID: "task", UserID: "user", ProjectID: project.ID, NodeID: "media", ProjectVersion: project.Version, ChannelID: "channel", Capability: capability, Status: "saving", TargetNode: encode(array(value["nodes"])[0]), Input: encode(generationInput{Capability: capability, Parameters: JSON(`{}`)}), Snapshot: encode(executionSnapshot{Model: ChannelModel{Model: "model", Parameters: JSON(`[]`)}})}
			if err := application.db.Create(&task).Error; err != nil { t.Fatal(err) }
			mimeType := "video/mp4"; if capability == "audio" { mimeType = "audio/mpeg" }
			for _, id := range []string{"one", "two"} {
				if err := application.db.Create(&Asset{ID: id, UserID: "user", Kind: capability, SaveState: "saved", Width: 1920, Height: 1080, DurationMS: 65000, Bytes: 2048, MimeType: mimeType}).Error; err != nil { t.Fatal(err) }
			}
			if err := application.applyTaskResult(task, []string{"one", "two"}, ""); err != nil { t.Fatal(err) }
			saved, err := application.GetProject("user", project.ID); if err != nil { t.Fatal(err) }
			if err := json.Unmarshal(saved.Document, &value); err != nil { t.Fatal(err) }
			metadata := object(object(array(value["nodes"])[0])["metadata"])
			results := array(metadata["mediaResults"])
			if len(results) != 2 || metadata["primaryMediaId"] != "one" || metadata["content"] != "/api/assets/one/file" { t.Fatalf("media results were not retained: %+v", metadata) }
			if metadata["prompt"] != "Keep this prompt" || metadata["images"] != nil { t.Fatal("media results changed the prompt or used image slots") }
			second := object(results[1])
			if second["storageKey"] != "asset:two" || second["mimeType"] != mimeType || second["durationMs"] != float64(65000) || second["bytes"] != float64(2048) { t.Fatalf("media parameters lost: %+v", second) }
			refs, err := validateDocument(saved.Document); if err != nil { t.Fatal(err) }
			if len(refs) != 2 { t.Fatalf("not all results have durable asset references: %v", refs) }
			if err := application.applyTaskResult(task, []string{"one", "two"}, ""); err != nil { t.Fatal(err) }
			again, err := application.GetProject("user", project.ID); if err != nil { t.Fatal(err) }
			if again.Version != saved.Version { t.Fatal("duplicate completion created another revision") }
			if err := application.db.Model(&GenerationTask{}).Where("id = ?", task.ID).Update("status", "succeeded").Error; err != nil { t.Fatal(err) }
			undone, err := application.RevertProject("user", project.ID, saved.Version, saved.Version); if err != nil { t.Fatal(err) }
			if err := json.Unmarshal(undone.Document, &value); err != nil { t.Fatal(err) }
			if object(object(array(value["nodes"])[0])["metadata"])["mediaResults"] != nil { t.Fatal("undo did not remove the completed result list") }
			redone, err := application.RevertProject("user", project.ID, undone.Version, undone.Version); if err != nil { t.Fatal(err) }
			if err := json.Unmarshal(redone.Document, &value); err != nil { t.Fatal(err) }
			if len(array(object(object(array(value["nodes"])[0])["metadata"])["mediaResults"])) != 2 { t.Fatal("redo did not restore all results") }
		})
	}
}

func TestMergeProjectKeepsPrimarySelectionWhileSiblingFinishes(t *testing.T) {
	document := JSON(`{"nodes":[{"id":"node","type":"text","metadata":{"status":"loading","content":"First","primaryTextId":"one","texts":[{"id":"one","content":"First","status":"success"},{"id":"two","content":"Second","status":"success"},{"id":"three","content":"","status":"loading"}]}}],"connections":[]}`)
	base := Project{Title: "Canvas", Document: document}
	edited, current := base, base
	edited.Document = editHistoryNode(t, document, func(node map[string]any) { metadata := object(node["metadata"]); metadata["content"], metadata["primaryTextId"] = "Second", "two" })
	current.Document = editHistoryNode(t, document, func(node map[string]any) { metadata := object(node["metadata"]); metadata["status"] = "success"; slot := object(array(metadata["texts"])[2]); slot["content"], slot["status"] = "Third", "success" })
	merged, err := mergeProject(base, edited, current); if err != nil { t.Fatal(err) }
	var value map[string]any
	if err := json.Unmarshal(merged.Document, &value); err != nil { t.Fatal(err) }
	metadata := object(object(array(value["nodes"])[0])["metadata"])
	if metadata["content"] != "Second" || metadata["primaryTextId"] != "two" || metadata["status"] != "success" { t.Fatalf("primary selection was overwritten: %+v", metadata) }
	if object(array(metadata["texts"])[2])["content"] != "Third" { t.Fatal("completed sibling was lost") }
}
