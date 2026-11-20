package app

import "testing"

func TestBuiltinCanvasNodeCatalog(test *testing.T) {
	application := historyTestApp(test)
	nodes, err := application.ListCanvasNodes()
	if err != nil { test.Fatal(err) }
	expected := map[string]bool{
		"text": true, "image": true, "video": true, "audio": true, "config": true, "group": true,
		"panorama:viewer": true, "sticky-note:note": true, canvasUpscaleNodeType: true,
	}
	if len(nodes) != len(expected) { test.Fatalf("expected %d builtin node types, got %d", len(expected), len(nodes)) }
	for _, node := range nodes {
		if !expected[node.Type] { test.Fatalf("unexpected or duplicate builtin node type: %s", node.Type) }
		delete(expected, node.Type)
	}
}
