package app

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"
)

func migrationTestAsset(t *testing.T, a *App) Asset {
	t.Helper()
	for _, storage := range []ObjectStorage{{ID: "source", Name: "Original", Provider: "s3", Endpoint: "https://source.example", Bucket: "source", AccessKeyID: "!", Secret: "!"}, {ID: "target", Name: "Destination", Provider: "s3", Endpoint: "https://target.example", Bucket: "target", AccessKeyID: "!", Secret: "!"}} {
		if err := a.db.Create(&storage).Error; err != nil { t.Fatal(err) }
	}
	asset := Asset{ID: identifier(), UserID: "owner", Kind: "image", MimeType: "image/png", Bytes: int64(len("original bytes")), StorageID: "source", SyncState: "synced", SaveState: "saved", Metadata: JSON(`{}`)}
	asset.Path = asset.ID+".png"
	if err := a.db.Create(&asset).Error; err != nil { t.Fatal(err) }
	if err := os.WriteFile(filepath.Join(a.root, "assets", asset.Path), []byte("original bytes"), 0600); err != nil { t.Fatal(err) }
	return asset
}

func TestAssetMigrationValidatesOwnerRevisionAndStorageReferences(t *testing.T) {
	a := assetFileTestApp(t); asset := migrationTestAsset(t, a)
	input := assetMigrationInput{StorageID: "target", ExpectedUpdatedAt: asset.UpdatedAt}
	if err := a.MigrateAsset("other", asset.ID, input); !errors.Is(err, gorm.ErrRecordNotFound) { t.Fatalf("another owner could migrate: %v", err) }
	input.ExpectedUpdatedAt = time.Time{}
	if err := a.MigrateAsset("owner", asset.ID, input); err == nil { t.Fatal("stale migration was accepted") }
	input.ExpectedUpdatedAt = asset.UpdatedAt
	if err := a.MigrateAsset("owner", asset.ID, input); err != nil { t.Fatal(err) }
	if err := a.MigrateAsset("owner", asset.ID, input); err == nil { t.Fatal("duplicate migration was accepted") }
	for _, id := range []string{"source", "target"} { if err := a.DeleteStorage(id); err == nil { t.Fatal("referenced migration storage could be deleted") } }
	if err := a.queueAssetSync(asset.ID); err != nil { t.Fatal(err) }
	var operations []FileOperation; if err := a.db.Find(&operations).Error; err != nil { t.Fatal(err) }
	if len(operations) != 1 || operations[0].SourceStorageID != "source" || operations[0].TargetStorageID != "target" { t.Fatal("migration duplicated or lost cloud locations") }
	rows := []Asset{asset}; if err := a.fillAssetStorage(rows); err != nil { t.Fatal(err) }
	if rows[0].StorageName != "Original" || rows[0].Migration == nil || rows[0].Migration.StorageName != "Destination" { t.Fatal("storage names were not included in asset metadata") }
	options, err := a.AssetStorageOptions(); if err != nil { t.Fatal(err) }
	raw, err := json.Marshal(options); if err != nil { t.Fatal(err) }
	for _, secret := range []string{"endpoint", "bucket", "accessKey", "secret", "source.example"} { if strings.Contains(string(raw), secret) { t.Fatal("asset storage choices exposed administrator configuration") } }
}

func TestAssetMigrationWaitsForLeasesAndResumesCleanupWithoutReupload(t *testing.T) {
	a := assetFileTestApp(t); asset := migrationTestAsset(t, a)
	operation := FileOperation{ID: identifier(), AssetID: asset.ID, Kind: "migrate", SourceStorageID: "source", TargetStorageID: "target", Stage: "switch"}
	if err := a.db.Create(&operation).Error; err != nil { t.Fatal(err) }
	if err := a.db.Create(&TaskAsset{TaskID: "active-task", AssetID: asset.ID}).Error; err != nil { t.Fatal(err) }
	complete, err := a.runAssetMigration(context.Background(), operation, suggestedPolicy()); if err != nil || complete { t.Fatalf("leased source was switched: %v", err) }
	if err := a.db.First(&asset, "id = ?", asset.ID).Error; err != nil { t.Fatal(err) }
	if asset.StorageID != "source" || asset.SyncState != "synced" { t.Fatal("waiting migration changed available source") }
	if err := a.db.Model(&TaskAsset{}).Where("asset_id = ?", asset.ID).Update("released", true).Error; err != nil { t.Fatal(err) }
	// Invalid encrypted credentials stop cleanup before a network call. The
	// durable switch must still point at the already copied destination.
	a.runFileOperation(context.Background(), operation)
	if err := a.db.First(&asset, "id = ?", asset.ID).Error; err != nil { t.Fatal(err) }
	if asset.StorageID != "target" || asset.SyncState != "synced" || asset.Error != "" { t.Fatal("old-copy cleanup failure damaged the new authoritative copy") }
	if err := a.db.First(&operation, "id = ?", operation.ID).Error; err != nil { t.Fatal(err) }
	if operation.Stage != "cleanup" || operation.Attempts != 1 || operation.Error == "" { t.Fatal("cleanup failure lost the resume stage") }
	if err := a.DeleteStorage("source"); err == nil { t.Fatal("old storage was removed before its copy was cleaned") }
	if err := a.RetryAssetSync("owner", asset.ID); err != nil { t.Fatal(err) }
	var retried FileOperation
	if err := a.db.First(&retried, "id = ?", operation.ID).Error; err != nil { t.Fatal(err) }
	if retried.Stage != "cleanup" || retried.Attempts != 1 || retried.NextRunAt != nil { t.Fatal("retry replaced migration history or restarted copying") }
	data, err := os.ReadFile(filepath.Join(a.root, "assets", asset.Path)); if err != nil || string(data) != "original bytes" { t.Fatal("migration changed the local original") }
}

func TestAssetMigrationCopyFailurePreservesSourceAndGlobalDeletionOwnsBothCopies(t *testing.T) {
	a := assetFileTestApp(t); asset := migrationTestAsset(t, a)
	if err := a.MigrateAsset("owner", asset.ID, assetMigrationInput{StorageID: "target", ExpectedUpdatedAt: asset.UpdatedAt}); err != nil { t.Fatal(err) }
	var operation FileOperation; if err := a.db.First(&operation, "asset_id = ? AND kind = ?", asset.ID, "migrate").Error; err != nil { t.Fatal(err) }
	a.runFileOperation(context.Background(), operation)
	if err := a.db.First(&asset, "id = ?", asset.ID).Error; err != nil { t.Fatal(err) }
	if asset.StorageID != "source" || asset.SyncState != "synced" { t.Fatal("failed copy replaced the source") }
	if _, err := a.DeleteAsset("owner", asset.ID); err != nil { t.Fatal(err) }
	if complete, err := a.runAssetMigration(context.Background(), operation, suggestedPolicy()); err != nil || complete { t.Fatal("migration continued after global deletion was requested") }
	if err := a.cleanAsset(asset.ID); err == nil { t.Fatal("deletion reported success despite cloud cleanup failure") }
	if err := a.db.First(&operation, "id = ?", operation.ID).Error; err != nil { t.Fatal("global deletion lost migration copies before cleanup completed") }
	if _, err := os.Stat(filepath.Join(a.root, "assets", asset.Path)); err != nil { t.Fatal("cloud failure deleted the local original") }
	if _, err := a.CallBusiness(context.Background(), Principal{User: User{ID: "owner"}, Scopes: []string{"edit"}, Projects: []string{"project"}}, "asset_migrate", map[string]any{"assetId": asset.ID, "storageId": "target"}); err == nil { t.Fatal("project-scoped token could migrate global storage") }
}

func TestDeletingUnsyncedMigrationStillPreparesAcceptedTask(t *testing.T) {
	a := assetFileTestApp(t); asset := migrationTestAsset(t, a)
	if err := a.db.Model(&asset).Updates(map[string]any{"sync_state": "local", "delete_state": "pending"}).Error; err != nil { t.Fatal(err) }
	operation := FileOperation{ID: identifier(), AssetID: asset.ID, Kind: "migrate", SourceStorageID: "source", TargetStorageID: "target", Stage: "switch"}
	if err := a.db.Create(&operation).Error; err != nil { t.Fatal(err) }
	if err := a.db.Create(&TaskAsset{TaskID: "waiting-task", AssetID: asset.ID}).Error; err != nil { t.Fatal(err) }
	complete, err := a.runAssetMigration(context.Background(), operation, suggestedPolicy()); if err != nil || complete { t.Fatalf("migration abandoned or cleaned the accepted task's copy: %v", err) }
	if err := a.db.First(&asset, "id = ?", asset.ID).Error; err != nil { t.Fatal(err) }
	if asset.StorageID != "target" || asset.SyncState != "synced" || asset.DeleteState != "pending" { t.Fatal("deletion and the waiting task cannot both make progress") }
	if err := a.db.First(&operation, "id = ?", operation.ID).Error; err != nil { t.Fatal(err) }
	if operation.Stage != "cleanup" { t.Fatal("global deletion lost track of the migration copies") }
}

func TestAssetMigrationRejectsIncompleteLocalOriginal(t *testing.T) {
	a := assetFileTestApp(t); asset := migrationTestAsset(t, a)
	if err := os.WriteFile(filepath.Join(a.root, "assets", asset.Path), []byte("partial"), 0600); err != nil { t.Fatal(err) }
	operation := FileOperation{ID: identifier(), AssetID: asset.ID, Kind: "migrate", SourceStorageID: "source", TargetStorageID: "target", Stage: "pending"}
	if err := a.db.Create(&operation).Error; err != nil { t.Fatal(err) }
	complete, err := a.runAssetMigration(context.Background(), operation, suggestedPolicy())
	var failure *Problem
	if complete || !errors.As(err, &failure) || failure.Code != "asset_size_changed" { t.Fatalf("incomplete original was uploaded: %v", err) }
	if err := a.db.First(&asset, "id = ?", asset.ID).Error; err != nil { t.Fatal(err) }
	if asset.StorageID != "source" || asset.SyncState != "synced" { t.Fatal("incomplete original replaced the usable cloud source") }
}
