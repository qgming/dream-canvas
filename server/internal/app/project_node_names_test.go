package app

import (
	"encoding/json"
	"testing"
)

func TestCanvasNodeNameIsTextNotAnAssetReference(t *testing.T) {
	for _, name := range []string{"asset:missing", "/api/assets/missing/file", "https://example.com/scene", "主角三视图"} {
		document := map[string]any{"nodes": []any{map[string]any{"id": "node", "type": "image", "name": name, "title": "Name", "position": map[string]any{"x": 0, "y": 0}, "width": 320, "height": 240, "metadata": map[string]any{"content": "/api/assets/actual/file", "storageKey": "asset:actual"}}}, "connections": []any{}}
		references, err := validateDocument(encode(document))
		if err != nil { t.Fatal(err) }
		if len(references) != 1 || references[0] != "actual" { t.Fatalf("name was treated as an asset reference: %v", references) }
	}
}

func TestCanvasAssetDeletionKeepsCustomNodeNames(t *testing.T) {
	for _, name := range []string{"asset:actual", "/api/assets/actual/file"} {
		document := encode(map[string]any{"nodes": []any{map[string]any{"id": "node", "name": name, "metadata": map[string]any{"content": "/api/assets/actual/file", "storageKey": "asset:actual"}}}})
		updated, err := deletedAssetPlaceholders(document, []Asset{{ID: "actual"}})
		if err != nil { t.Fatal(err) }
		var saved map[string]any
		if err := json.Unmarshal(updated, &saved); err != nil { t.Fatal(err) }
		node := object(array(saved["nodes"])[0])
		if node["name"] != name { t.Fatal("asset deletion rewrote the node name") }
		if object(node["metadata"])["storageKey"] != "deleted-asset:actual" { t.Fatal("actual media was not replaced") }
	}
}

func TestCanvasOperationRenameKeepsNodeIdentity(t *testing.T) {
	service := historyTestApp(t)
	document := editHistoryNode(t, historyDocument(), func(node map[string]any) { node["identity"] = map[string]any{"type": "text", "number": 2, "copy": 1} })
	project, err := service.CreateProject("user", projectInput{Title: "Canvas", Document: document})
	if err != nil { t.Fatal(err) }
	saved, err := service.ApplyCanvasOperations(Principal{User: User{ID: "user"}}, map[string]any{"projectId": project.ID, "version": project.Version, "ops": []any{map[string]any{"type": "update_node", "id": "a", "patch": map[string]any{"title": "主角台词"}}}})
	if err != nil { t.Fatal(err) }
	var value map[string]any
	if err := json.Unmarshal(saved.Document, &value); err != nil { t.Fatal(err) }
	node := object(array(value["nodes"])[0])
	if node["title"] != "主角台词" || node["name"] != "主角台词" { t.Fatal("rename did not update the displayed name") }
	if object(node["identity"])["number"] != float64(2) { t.Fatal("rename changed the automatic node number") }
	if object(node["metadata"])["content"] != "base" { t.Fatal("rename changed node content") }
}
