package app

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestAssetProjectToolsRespectCanvasTokenScope(test *testing.T) {
	application := assetFileTestApp(test)
	if err := application.db.AutoMigrate(&AssetProject{}, &AssetReference{}); err != nil {
		test.Fatal(err)
	}
	assistant := Principal{User: User{ID: "owner"}, Scopes: []string{"read", "edit", "delete"}, FixedProject: true, TargetProjectID: "canvas"}
	scoped := Principal{User: assistant.User, Scopes: assistant.Scopes, Projects: []string{"canvas"}}
	call := func(principal Principal, name string, args map[string]any) any {
		test.Helper()
		value, err := application.CallBusiness(context.Background(), principal, name, args)
		if err != nil {
			test.Fatalf("%s: %v", name, err)
		}
		return value
	}
	project := call(assistant, "asset_project_create", map[string]any{"title": "Short film"}).(AssetProject)
	asset := call(assistant, "asset_text_create", map[string]any{"title": "Storyboard", "metadata": map[string]any{}, "assetProjectId": project.ID}).(Asset)
	unassigned := call(assistant, "asset_text_create", map[string]any{"title": "Loose draft", "metadata": map[string]any{}}).(Asset)
	if asset.AssetProjectID != project.ID || unassigned.AssetProjectID != defaultAssetProjectID {
		test.Fatal("text asset creation did not save the selected or default project")
	}
	filtered := call(assistant, "assets_list", map[string]any{"assetProjectId": defaultAssetProjectID}).([]Asset)
	if len(filtered) != 1 || filtered[0].ID != unassigned.ID {
		test.Fatalf("default project filter included another project: %+v", filtered)
	}
	if err := application.db.Create(&AssetReference{ProjectID: "canvas", AssetID: asset.ID}).Error; err != nil {
		test.Fatal(err)
	}
	referenced := call(scoped, "assets_list", nil).([]Asset)
	if len(referenced) != 1 || referenced[0].ID != asset.ID {
		test.Fatalf("canvas-scoped list changed its reference boundary: %+v", referenced)
	}
	for _, value := range []any{referenced, call(scoped, "asset_get", map[string]any{"assetId": asset.ID})} {
		data, err := json.Marshal(value)
		if err != nil || strings.Contains(string(data), `"assetProjectId"`) {
			test.Fatalf("canvas-scoped read did not omit the organization metadata: %s (%v)", data, err)
		}
	}
	for _, name := range []string{"asset_projects_list", "asset_project_create", "asset_project_rename", "asset_project_delete", "asset_move", "assets_list", "asset_text_create"} {
		_, err := application.CallBusiness(context.Background(), scoped, name, map[string]any{"assetProjectId": defaultAssetProjectID})
		var failure *Problem
		if !errors.As(err, &failure) || failure.Status != 403 {
			test.Fatalf("canvas-scoped token could reach %s: %v", name, err)
		}
	}
	noDelete := assistant
	noDelete.Scopes = []string{"read", "edit"}
	_, err := application.CallBusiness(context.Background(), noDelete, "asset_project_delete", map[string]any{"assetProjectId": project.ID, "version": float64(project.Version)})
	var failure *Problem
	if !errors.As(err, &failure) || failure.Status != 403 {
		test.Fatalf("deleting an asset project did not require delete scope: %v", err)
	}
}
