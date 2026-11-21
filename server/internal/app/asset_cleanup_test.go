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
	if err := application.RetryAssetCleanup("other", asset.ID, assetCleanupInput{}); !errors.Is(err, gorm.ErrRecordNotFound) { t.Fatalf("another user could retry cleanup: %v", err) }
	if err := application.db.Model(&asset).Update("delete_state", "").Error; err != nil { t.Fatal(err) }
	if err := application.RetryAssetCleanup("owner", asset.ID, assetCleanupInput{}); !errors.Is(err, gorm.ErrRecordNotFound) { t.Fatalf("cleanup bypassed the asset deletion state: %v", err) }
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
	if err := application.RetryAssetCleanup("owner", asset.ID, assetCleanupInput{}); err != nil { t.Fatal(err) }
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

func TestLocalAssetCleanupDetachesUnavailableStorageAndMigrationCopies(t *testing.T) {
	for _, entry := range []string{"http", "mcp", "assistant"} {
		t.Run(entry, func(t *testing.T) {
			a := assetFileTestApp(t); asset := migrationTestAsset(t, a)
			preview := filepath.Join(a.root, "assets", asset.ID+".preview.png")
			if err := os.WriteFile(preview, []byte("preview"), 0600); err != nil { t.Fatal(err) }
			if _, err := a.DeleteAsset("owner", asset.ID); err != nil { t.Fatal(err) }
			var operation FileOperation
			if err := a.db.First(&operation, "asset_id = ? AND kind = ?", asset.ID, "delete").Error; err != nil { t.Fatal(err) }
			for _, pending := range []FileOperation{
				{ID: identifier(), AssetID: asset.ID, Kind: "sync"},
				{ID: identifier(), AssetID: asset.ID, Kind: "migrate", SourceStorageID: "source", TargetStorageID: "target", Stage: "cleanup"},
			} { if err := a.db.Create(&pending).Error; err != nil { t.Fatal(err) } }
			// Invalid encrypted credentials reject a cloud request before networking.
			// Normal deletion must retain both files and all cloud references.
			a.runFileOperation(context.Background(), operation)
			if err := a.db.First(&asset, "id = ?", asset.ID).Error; err != nil { t.Fatal(err) }
			if asset.DeleteState != "pending" || asset.RetainCloud || !strings.Contains(asset.Error, "云端副本删除失败") { t.Fatal("cloud cleanup failure lost its cause or silently completed deletion") }
			for _, name := range []string{filepath.Join(a.root, "assets", asset.Path), preview} { if _, err := os.Stat(name); err != nil { t.Fatal("cloud failure removed a local file") } }
			for _, id := range []string{"source", "target"} { if err := a.DeleteStorage(id); err == nil { t.Fatal("pending cloud references did not protect storage") } }
			if err := a.db.First(&operation, "id = ?", operation.ID).Error; err != nil { t.Fatal(err) }
			previous := operation
			for range 2 {
				if entry == "http" {
					router := assetFileTestRouter(a); router.POST("/api/assets/:id/cleanup", a.retryAssetCleanup)
					response := httptest.NewRecorder()
					router.ServeHTTP(response, httptest.NewRequest("POST", "/api/assets/"+asset.ID+"/cleanup", strings.NewReader(`{"retainCloud":true,"confirmed":true}`)))
					if response.Code != 202 { t.Fatalf("local cleanup returned %d: %s", response.Code, response.Body.String()) }
				} else {
					principal := Principal{User: User{ID: "owner"}, Scopes: []string{"edit", "delete"}, FixedProject: entry == "assistant"}
					if _, err := a.CallBusiness(context.Background(), principal, "asset_cleanup", map[string]any{"assetId": asset.ID, "retainCloud": true, "confirmed": true}); err != nil { t.Fatal(err) }
				}
			}
			// Ordinary retry and startup queue repair must preserve the saved intent.
			if err := a.RetryAssetCleanup("owner", asset.ID, assetCleanupInput{}); err != nil { t.Fatal(err) }
			if err := queueAssetCleanup(a.db, asset.ID); err != nil { t.Fatal(err) }
			if err := a.db.First(&asset, "id = ?", asset.ID).Error; err != nil { t.Fatal(err) }
			if !asset.RetainCloud || asset.DeleteState != "pending" { t.Fatal("cloud retention was not persisted") }
			if err := a.db.First(&operation, "id = ?", previous.ID).Error; err != nil { t.Fatal(err) }
			if operation.Attempts != previous.Attempts || operation.Error != previous.Error || operation.NextRunAt != nil { t.Fatal("changing cleanup mode replaced the queue or erased retry history") }
			// Another live asset must continue protecting its storage configuration.
			other := Asset{ID: identifier(), UserID: "owner", Kind: "image", StorageID: "source", Metadata: JSON(`{}`)}
			if err := a.db.Create(&other).Error; err != nil { t.Fatal(err) }
			a.runFileOperation(context.Background(), operation)
			if err := a.db.First(&asset, "id = ?", asset.ID).Error; err != nil { t.Fatal(err) }
			if asset.DeleteState != "deleted" || asset.StorageID != "" || !asset.RetainCloud || asset.Error != "" { t.Fatal("local cleanup did not finish and detach unavailable storage") }
			for _, name := range []string{filepath.Join(a.root, "assets", asset.Path), preview} { if _, err := os.Stat(name); !errors.Is(err, os.ErrNotExist) { t.Fatal("local cleanup left an original or preview") } }
			var pending int64
			if err := a.db.Model(&FileOperation{}).Where("asset_id = ?", asset.ID).Count(&pending).Error; err != nil { t.Fatal(err) }
			if pending != 0 { t.Fatal("local cleanup left cloud sync or migration work") }
			if err := a.DeleteStorage("target"); err != nil { t.Fatal("detached migration target still blocks removal:", err) }
			if err := a.DeleteStorage("source"); err == nil { t.Fatal("local cleanup bypassed another asset's storage reference") }
			if _, err := a.DeleteAsset("owner", other.ID); err != nil { t.Fatal(err) }
			if err := a.RetryAssetCleanup("owner", other.ID, assetCleanupInput{RetainCloud: true, Confirmed: true}); err != nil { t.Fatal(err) }
			if err := a.cleanAsset(other.ID); err != nil { t.Fatal(err) }
			if err := a.DeleteStorage("source"); err != nil { t.Fatal("detached source still blocks removal:", err) }
			if err := a.cleanAsset(asset.ID); err != nil { t.Fatal("completed local cleanup was not idempotent:", err) }
		})
	}
}

func TestLocalAssetCleanupRequiresConfirmationOwnershipAndDeletePermission(t *testing.T) {
	a := assetFileTestApp(t); asset := migrationTestAsset(t, a)
	input := assetCleanupInput{RetainCloud: true, Confirmed: true}
	if err := a.RetryAssetCleanup("owner", asset.ID, input); !errors.Is(err, gorm.ErrRecordNotFound) { t.Fatal("local cleanup created new deletion intent") }
	if _, err := a.DeleteAsset("owner", asset.ID); err != nil { t.Fatal(err) }
	if err := a.RetryAssetCleanup("other", asset.ID, input); !errors.Is(err, gorm.ErrRecordNotFound) { t.Fatal("another user could detach storage") }
	var failure *Problem
	if err := a.RetryAssetCleanup("owner", asset.ID, assetCleanupInput{RetainCloud: true}); !errors.As(err, &failure) || failure.Code != "confirmation_required" { t.Fatal("local cleanup did not require explicit confirmation") }
	for _, principal := range []Principal{
		{User: User{ID: "owner"}, Scopes: []string{"edit"}},
		{User: User{ID: "owner"}, Scopes: []string{"edit", "delete"}, Projects: []string{"project"}},
	} {
		if _, err := a.CallBusiness(context.Background(), principal, "asset_cleanup", map[string]any{"assetId": asset.ID, "retainCloud": true, "confirmed": true}); err == nil { t.Fatal("local cleanup escaped delete permission or project scope") }
	}
	a.active = map[string]context.CancelFunc{"file:"+asset.ID: func() {}}
	if err := a.RetryAssetCleanup("owner", asset.ID, input); !errors.As(err, &failure) || failure.Code != "asset_busy" { t.Fatal("local cleanup changed intent while cloud work was active") }
	if err := a.db.First(&asset, "id = ?", asset.ID).Error; err != nil { t.Fatal(err) }
	if asset.RetainCloud { t.Fatal("a rejected request changed cloud cleanup intent") }
}

func TestLocalAssetCleanupStillWaitsForTaskAndResponseCopies(t *testing.T) {
	a := assetFileTestApp(t); asset := migrationTestAsset(t, a)
	if _, err := a.DeleteAsset("owner", asset.ID); err != nil { t.Fatal(err) }
	if err := a.RetryAssetCleanup("owner", asset.ID, assetCleanupInput{RetainCloud: true, Confirmed: true}); err != nil { t.Fatal(err) }
	task := GenerationTask{ID: identifier(), UserID: "owner", Status: "confirmation_required", ResponseCleanupPending: true}
	if err := a.db.Create(&task).Error; err != nil { t.Fatal(err) }
	if err := a.db.Create(&TaskAsset{TaskID: task.ID, AssetID: asset.ID}).Error; err != nil { t.Fatal(err) }
	var failure *Problem
	if err := a.cleanAsset(asset.ID); !errors.As(err, &failure) || failure.Code != "asset_in_use" { t.Fatal("local cleanup bypassed a task lease") }
	if err := a.db.Model(&TaskAsset{}).Where("task_id = ?", task.ID).Update("released", true).Error; err != nil { t.Fatal(err) }
	if err := a.cleanAsset(asset.ID); !errors.As(err, &failure) || failure.Code != "response_cleanup_pending" { t.Fatal("local cleanup bypassed retained response copies") }
	if _, err := os.Stat(filepath.Join(a.root, "assets", asset.Path)); err != nil { t.Fatal("blocked local cleanup removed the original") }
	if err := a.DeleteStorage("source"); err == nil { t.Fatal("blocked local cleanup released storage early") }
	if err := a.db.Model(&task).Update("response_cleanup_pending", false).Error; err != nil { t.Fatal(err) }
	if err := a.cleanAsset(asset.ID); err != nil { t.Fatal(err) }
	if err := a.DeleteStorage("source"); err != nil { t.Fatal("released local cleanup still blocks storage removal:", err) }
}
