package app

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"gorm.io/gorm"
)

func TestAssetProjectsMoveAndDeletePreserveOriginal(t *testing.T) {
	app := assetFileTestApp(t)
	if err := app.db.AutoMigrate(&AssetProject{}); err != nil {
		t.Fatal(err)
	}
	project, err := app.CreateAssetProject("owner", "  Studio  ")
	if err != nil || project.Title != "Studio" || project.Version != 1 {
		t.Fatalf("created project = %+v, error = %v", project, err)
	}
	otherProject, err := app.CreateAssetProject("other", "Private")
	if err != nil {
		t.Fatal(err)
	}
	projects, err := app.ListAssetProjects("owner")
	if err != nil || len(projects) != 2 || projects[0].ID != defaultAssetProjectID || !projects[0].IsDefault || projects[1].ID != project.ID {
		t.Fatalf("project list = %+v, error = %v", projects, err)
	}
	asset := Asset{ID: identifier(), UserID: "owner", Kind: "image", SaveState: "saved", SyncState: "synced", StorageID: "cloud", Metadata: JSON(`{}`)}
	asset.Path = asset.ID + ".png"
	if err := app.db.Create(&asset).Error; err != nil {
		t.Fatal(err)
	}
	if asset.AssetProjectID != defaultAssetProjectID {
		t.Fatalf("new asset project = %q", asset.AssetProjectID)
	}
	original := filepath.Join(app.root, "assets", asset.Path)
	if err := os.WriteFile(original, []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := app.MoveAsset("owner", asset.ID, otherProject.ID, defaultAssetProjectID); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("move to another account's project: %v", err)
	}
	if err := app.MoveAsset("other", asset.ID, otherProject.ID, defaultAssetProjectID); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("move another account's asset: %v", err)
	}
	for range 2 {
		if err := app.MoveAsset("owner", asset.ID, project.ID, defaultAssetProjectID); err != nil {
			t.Fatal(err)
		}
	}
	var conflict *Problem
	if err := app.MoveAsset("owner", asset.ID, defaultAssetProjectID, defaultAssetProjectID); !errors.As(err, &conflict) || conflict.Code != "asset_project_changed" {
		t.Fatalf("stale move: %v", err)
	}
	updated, err := app.RenameAssetProject("owner", project.ID, "Studio 2", project.Version)
	if err != nil || updated.Version != project.Version+1 || updated.Title != "Studio 2" {
		t.Fatalf("renamed project = %+v, error = %v", updated, err)
	}
	if err := app.DeleteAssetProject("owner", project.ID, project.Version); !errors.As(err, &conflict) || conflict.Code != "version_conflict" {
		t.Fatalf("stale project deletion: %v", err)
	}
	if err := app.DeleteAssetProject("owner", project.ID, updated.Version); err != nil {
		t.Fatal(err)
	}
	var stored Asset
	if err := app.db.First(&stored, "id = ?", asset.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.AssetProjectID != defaultAssetProjectID || stored.Path != asset.Path || stored.StorageID != asset.StorageID || stored.DeleteState != "" {
		t.Fatalf("project deletion modified the asset beyond placement: %+v", stored)
	}
	if bytes, err := os.ReadFile(original); err != nil || string(bytes) != "original" {
		t.Fatalf("project deletion modified original: %q, error = %v", bytes, err)
	}
	var operations int64
	if err := app.db.Model(&FileOperation{}).Count(&operations).Error; err != nil || operations != 0 {
		t.Fatalf("project deletion queued file operations: %d, error = %v", operations, err)
	}
}

func TestAssetProjectUploadValidatesAndPersistsPlacement(t *testing.T) {
	app := assetFileTestApp(t)
	if err := app.db.AutoMigrate(&AssetProject{}); err != nil {
		t.Fatal(err)
	}
	project, err := app.CreateAssetProject("owner", "Studio")
	if err != nil {
		t.Fatal(err)
	}
	other, err := app.CreateAssetProject("other", "Private")
	if err != nil {
		t.Fatal(err)
	}
	router := assetFileTestRouter(app)
	original := assetMediaFixtures(t)[0].data
	upload := func(projectID string) *httptest.ResponseRecorder {
		request := httptest.NewRequest("POST", "/api/assets", bytes.NewReader(original))
		request.Header.Set("Content-Type", "image/png")
		request.Header.Set("X-Asset-Project", projectID)
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		return response
	}
	if response := upload(other.ID); response.Code != 404 {
		t.Fatalf("upload into another account: %d %s", response.Code, response.Body.String())
	}
	response := upload(project.ID)
	if response.Code != 201 {
		t.Fatalf("upload into owned project: %d %s", response.Code, response.Body.String())
	}
	var asset Asset
	if err := json.Unmarshal(response.Body.Bytes(), &asset); err != nil || asset.AssetProjectID != project.ID {
		t.Fatalf("upload response placement = %q, error = %v", asset.AssetProjectID, err)
	}
	if assets, err := app.ListLibraryAssets("owner", defaultAssetProjectID); err != nil || len(assets) != 0 {
		t.Fatalf("project upload also entered the default project: %+v, error = %v", assets, err)
	}
	if err := app.DeleteAssetProject("owner", project.ID, project.Version); err != nil {
		t.Fatal(err)
	}
	var conflict *Problem
	if err := app.updateAssetMetadata("owner", asset.ID, "Imported name", JSON(`{}`), &project.ID); !errors.As(err, &conflict) || conflict.Code != "asset_project_changed" {
		t.Fatalf("upload finalization did not detect project deletion: %v", err)
	}
	if response := upload(project.ID); response.Code != 404 {
		t.Fatalf("upload into deleted project: %d %s", response.Code, response.Body.String())
	}
	if assets, err := app.ListLibraryAssets("owner", defaultAssetProjectID); err != nil || len(assets) != 1 || assets[0].ID != asset.ID {
		t.Fatalf("project deletion left incorrect assets in the default project: %+v, error = %v", assets, err)
	}
}
