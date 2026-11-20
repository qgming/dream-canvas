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

func TestAssetCleanupRetryReusesExistingOperation(t *testing.T) {
	for _, entry := range []string{"http", "mcp"} {
		t.Run(entry, func(t *testing.T) {
			application := assetFileTestApp(t)
			asset := Asset{ID: identifier(), UserID: "owner", Kind: "image", DeleteState: "pending", Metadata: JSON(`{}`)}
			if err := application.db.Create(&asset).Error; err != nil { t.Fatal(err) }
			next := time.Now().Add(time.Hour)
			operation := FileOperation{ID: identifier(), AssetID: asset.ID, Kind: "delete", Attempts: 3, NextRunAt: &next, Error: "previous failure"}
			if err := application.db.Create(&operation).Error; err != nil { t.Fatal(err) }
			if err := application.db.Create(&FileOperation{ID: identifier(), AssetID: asset.ID, Kind: "sync", NextRunAt: &next}).Error; err != nil { t.Fatal(err) }
			for range 2 { if err := queueAssetCleanup(application.db, asset.ID); err != nil { t.Fatal(err) } }
			var saved FileOperation
			if err := application.db.First(&saved, "id = ?", operation.ID).Error; err != nil { t.Fatal(err) }
			if saved.NextRunAt == nil || !saved.NextRunAt.Equal(next) { t.Fatal("startup recovery changed the scheduled retry") }
			router := assetFileTestRouter(application)
			router.POST("/api/assets/:id/cleanup", application.retryAssetCleanup)
			for range 2 {
				if entry == "http" {
					response := httptest.NewRecorder()
					router.ServeHTTP(response, httptest.NewRequest("POST", "/api/assets/"+asset.ID+"/cleanup", nil))
					if response.Code != 202 { t.Fatalf("retry returned %d: %s", response.Code, response.Body.String()) }
				} else {
					if _, err := application.CallBusiness(context.Background(), Principal{User: User{ID: "owner"}, Scopes: []string{"edit"}}, "asset_cleanup", map[string]any{"assetId": asset.ID}); err != nil { t.Fatal(err) }
				}
			}
			if err := application.db.First(&saved, "id = ?", operation.ID).Error; err != nil { t.Fatal(err) }
			if saved.Attempts != 3 || saved.NextRunAt != nil || saved.Error != operation.Error { t.Fatal("retry replaced the operation or erased its history") }
			var count int64
			if err := application.db.Model(&FileOperation{}).Where("asset_id = ? AND kind = ?", asset.ID, "delete").Count(&count).Error; err != nil { t.Fatal(err) }
			if count != 1 { t.Fatal("retry created duplicate delete operations") }
			var sync FileOperation
			if err := application.db.First(&sync, "asset_id = ? AND kind = ?", asset.ID, "sync").Error; err != nil { t.Fatal(err) }
			if sync.NextRunAt == nil || !sync.NextRunAt.Equal(next) { t.Fatal("delete retry changed a separate sync operation") }
		})
	}
}

func TestAssetCleanupRetryRequiresOwnedPendingAsset(t *testing.T) {
	application := assetFileTestApp(t)
	asset := Asset{ID: identifier(), UserID: "owner", Kind: "image", DeleteState: "pending", Metadata: JSON(`{}`)}
	if err := application.db.Create(&asset).Error; err != nil { t.Fatal(err) }
	if err := application.RetryAssetCleanup("other", asset.ID); !errors.Is(err, gorm.ErrRecordNotFound) { t.Fatalf("another user could retry cleanup: %v", err) }
	if err := application.db.Model(&asset).Update("delete_state", "").Error; err != nil { t.Fatal(err) }
	if err := application.RetryAssetCleanup("owner", asset.ID); !errors.Is(err, gorm.ErrRecordNotFound) { t.Fatalf("cleanup bypassed the asset deletion state: %v", err) }
	var count int64
	if err := application.db.Model(&FileOperation{}).Count(&count).Error; err != nil { t.Fatal(err) }
	if count != 0 { t.Fatal("rejected retries queued file cleanup") }
}

func TestAssetCleanupReportsUnresolvedTaskAndPreservesFiles(t *testing.T) {
	application := assetFileTestApp(t)
	asset := Asset{ID: identifier(), UserID: "owner", Kind: "image", SaveState: "saved", DeleteState: "pending", Metadata: JSON(`{}`)}
	asset.Path = asset.ID+".png"
	if err := application.db.Create(&asset).Error; err != nil { t.Fatal(err) }
	task := GenerationTask{ID: identifier(), UserID: "owner", ProjectID: "another-project", Status: "confirmation_required"}
	if err := application.db.Create(&task).Error; err != nil { t.Fatal(err) }
	if err := application.db.Create(&TaskAsset{TaskID: task.ID, AssetID: asset.ID}).Error; err != nil { t.Fatal(err) }
	for _, name := range []string{asset.Path, asset.ID+".preview.png"} {
		if err := os.WriteFile(filepath.Join(application.root, "assets", name), []byte("original"), 0600); err != nil { t.Fatal(err) }
	}
	router := assetFileTestRouter(application)
	router.GET("/api/assets", application.listAssets)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest("GET", "/api/assets?deleting=true", nil))
	var pending []Asset
	if response.Code != 200 { t.Fatalf("cannot read pending deletions: %s", response.Body.String()) }
	if err := json.Unmarshal(response.Body.Bytes(), &pending); err != nil { t.Fatal(err) }
	if len(pending) != 1 || pending[0].CleanupTaskID != task.ID || !strings.Contains(pending[0].Error, "待人工核对") { t.Fatal("pending deletion hid its blocking task") }
	value, err := application.CallBusiness(context.Background(), Principal{User: User{ID: "owner"}, Scopes: []string{"read"}}, "asset_get", map[string]any{"assetId": asset.ID})
	if err != nil { t.Fatal(err) }
	if value.(Asset).CleanupTaskID != task.ID { t.Fatal("HTTP and MCP reported different cleanup blockers") }
	if err := application.db.AutoMigrate(&AssetReference{}); err != nil { t.Fatal(err) }
	if err := application.db.Create(&AssetReference{ProjectID: "allowed-project", AssetID: asset.ID}).Error; err != nil { t.Fatal(err) }
	value, err = application.CallBusiness(context.Background(), Principal{User: User{ID: "owner"}, Scopes: []string{"read"}, Projects: []string{"allowed-project"}}, "asset_get", map[string]any{"assetId": asset.ID})
	if err != nil { t.Fatal(err) }
	if value.(Asset).CleanupTaskID != "" { t.Fatal("a project-scoped token revealed a task from another project") }
	if err := application.RetryAssetCleanup("owner", asset.ID); err != nil { t.Fatal(err) }
	var problem *Problem
	if err := application.cleanAsset(asset.ID); !errors.As(err, &problem) || problem.Code != "asset_in_use" { t.Fatalf("unresolved task did not block cleanup: %v", err) }
	for _, name := range []string{asset.Path, asset.ID+".preview.png"} {
		if _, err := os.Stat(filepath.Join(application.root, "assets", name)); err != nil { t.Fatal("cleanup removed a leased original or preview") }
	}
	if err := application.db.First(&task, "id = ?", task.ID).Error; err != nil { t.Fatal(err) }
	if task.Status != "confirmation_required" { t.Fatal("cleanup retry changed an uncertain task outcome") }
	if err := application.db.Model(&task).Update("status", "succeeded").Error; err != nil { t.Fatal(err) }
	if err := application.db.Model(&TaskAsset{}).Where("task_id = ?", task.ID).Update("released", true).Error; err != nil { t.Fatal(err) }
	if err := application.cleanAsset(asset.ID); err != nil { t.Fatal(err) }
	for _, name := range []string{asset.Path, asset.ID+".preview.png"} {
		if _, err := os.Stat(filepath.Join(application.root, "assets", name)); !errors.Is(err, os.ErrNotExist) { t.Fatal("released asset files were not cleaned") }
	}
}
