package app

import (
	"context"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"

	"gorm.io/gorm"
)

func TestDirectProjectDeletionSharesVersionAndScopeChecks(t *testing.T) {
	for _, entry := range []string{"http", "mcp", "assistant"} {
		t.Run(entry, func(t *testing.T) {
			a := assetFileTestApp(t)
			if err := a.db.AutoMigrate(&Project{}, &ProjectRevision{}, &AssetReference{}); err != nil { t.Fatal(err) }
			project := Project{ID: identifier(), UserID: "owner", Title: "Project", Version: 2, Document: JSON(`{"nodes":[],"connections":[]}`)}
			asset := Asset{ID: identifier(), UserID: "owner", Kind: "text", Metadata: JSON(`{"content":"keep"}`)}
			task := GenerationTask{ID: identifier(), UserID: "owner", ProjectID: project.ID, Status: "running"}
			for _, value := range []any{&project, &asset, &task, &AssetReference{ProjectID: project.ID, AssetID: asset.ID}, &ProjectRevision{ProjectID: project.ID, Version: project.Version, Title: project.Title, Document: project.Document}} {
				if err := a.db.Create(value).Error; err != nil { t.Fatal(err) }
			}
			if err := a.DeleteProject("other", project.ID, project.Version); !errors.Is(err, gorm.ErrRecordNotFound) { t.Fatal("another user could delete the project") }
			if err := a.DeleteProject("owner", project.ID, 1); err == nil { t.Fatal("a stale version could delete the project") }
			if entry == "http" {
				router := assetFileTestRouter(a); router.DELETE("/api/projects/:id", a.deleteProject)
				response := httptest.NewRecorder(); router.ServeHTTP(response, httptest.NewRequest("DELETE", "/api/projects/"+project.ID, strings.NewReader(`{"version":2}`)))
				if response.Code != 204 { t.Fatalf("project deletion returned %d: %s", response.Code, response.Body.String()) }
			} else {
				principal := Principal{User: User{ID: "owner"}, Scopes: []string{"delete"}, Projects: []string{project.ID}}
				if entry == "assistant" { principal.FixedProject, principal.TargetProjectID, principal.Projects = true, project.ID, nil }
				args := map[string]any{"projectId": project.ID, "version": float64(project.Version)}
				denied := principal; denied.Scopes = []string{"read", "edit"}
				if _, err := a.CallBusiness(context.Background(), denied, "project_delete", args); err == nil { t.Fatal("deletion did not require delete permission") }
				denied = principal; if denied.FixedProject { denied.TargetProjectID = "other-project" } else { denied.Projects = []string{"other-project"} }
				if _, err := a.CallBusiness(context.Background(), denied, "project_delete", args); err == nil { t.Fatal("deletion escaped the project scope") }
				if _, err := a.CallBusiness(context.Background(), principal, "project_delete", args); err != nil { t.Fatal(err) }
			}
			for _, model := range []any{&Project{}, &ProjectRevision{}, &AssetReference{}} {
				var count int64; if err := a.db.Model(model).Count(&count).Error; err != nil { t.Fatal(err) }; if count != 0 { t.Fatal("deleted project retained its document, history or references") }
			}
			if err := a.db.First(&asset, "id = ?", asset.ID).Error; err != nil || asset.DeleteState != "" { t.Fatal("project deletion removed the media asset") }
			if err := a.db.First(&task, "id = ?", task.ID).Error; err != nil || task.Status != "running" { t.Fatal("project deletion changed a submitted task") }
		})
	}
}

func TestDirectAssetDeletionQueuesOnceAndPreservesTaskLease(t *testing.T) {
	for _, entry := range []string{"http", "mcp", "assistant"} {
		t.Run(entry, func(t *testing.T) {
			a := assetFileTestApp(t)
			asset := Asset{ID: identifier(), UserID: "owner", Kind: "text", SaveState: "saved", Metadata: JSON(`{"content":"leased"}`)}
			task := GenerationTask{ID: identifier(), UserID: "owner", Status: "confirmation_required"}
			for _, value := range []any{&asset, &task, &TaskAsset{TaskID: task.ID, AssetID: asset.ID}} { if err := a.db.Create(value).Error; err != nil { t.Fatal(err) } }
			if _, err := a.DeleteAsset("other", asset.ID); !errors.Is(err, gorm.ErrRecordNotFound) { t.Fatal("another user could delete the asset") }
			if entry == "http" {
				router := assetFileTestRouter(a); router.DELETE("/api/assets/:id", a.deleteAsset)
				response := httptest.NewRecorder(); router.ServeHTTP(response, httptest.NewRequest("DELETE", "/api/assets/"+asset.ID, nil))
				if response.Code != 202 || !strings.Contains(response.Body.String(), `"deleteState":"pending"`) { t.Fatalf("deletion hid pending cleanup: %s", response.Body.String()) }
			} else {
				principal := Principal{User: User{ID: "owner"}, Scopes: []string{"delete"}, FixedProject: entry == "assistant", TargetProjectID: "project"}
				args := map[string]any{"assetId": asset.ID}
				denied := principal; denied.Projects = []string{"project"}
				if _, err := a.CallBusiness(context.Background(), denied, "asset_delete", args); err == nil { t.Fatal("a project-scoped token could globally delete an asset") }
				denied = principal; denied.Scopes = []string{"read", "edit"}
				if _, err := a.CallBusiness(context.Background(), denied, "asset_delete", args); err == nil { t.Fatal("asset deletion did not require delete permission") }
				value, err := a.CallBusiness(context.Background(), principal, "asset_delete", args)
				if err != nil { t.Fatal(err) }; if value.(assetDeleteResult).DeleteState != "pending" { t.Fatal("deletion reported cleanup complete") }
			}
			var operation FileOperation
			if err := a.db.First(&operation, "asset_id = ? AND kind = ?", asset.ID, "delete").Error; err != nil { t.Fatal(err) }
			if _, err := a.DeleteAsset("owner", asset.ID); err != nil { t.Fatal(err) }
			var operations []FileOperation
			if err := a.db.Where("asset_id = ? AND kind = ?", asset.ID, "delete").Find(&operations).Error; err != nil { t.Fatal(err) }
			if len(operations) != 1 || operations[0].ID != operation.ID { t.Fatal("repeated deletion replaced or duplicated cleanup") }
			var pending *Problem
			if err := a.cleanAsset(asset.ID); !errors.As(err, &pending) || pending.Code != "asset_in_use" { t.Fatal("deletion bypassed a running task's lease") }
			if err := a.db.First(&task, "id = ?", task.ID).Error; err != nil || task.Status != "confirmation_required" { t.Fatal("deletion resolved an uncertain task") }
			if err := a.db.Model(&TaskAsset{}).Where("task_id = ?", task.ID).Update("released", true).Error; err != nil { t.Fatal(err) }
			if err := a.cleanAsset(asset.ID); err != nil { t.Fatal(err) }
			result, err := a.DeleteAsset("owner", asset.ID); if err != nil || result.DeleteState != "deleted" { t.Fatal("deleted asset did not retain its terminal state") }
		})
	}
}
