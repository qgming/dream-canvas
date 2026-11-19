package app

import (
	"bytes"
	"context"
	"errors"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func assetRepairFixture(test *testing.T, application *App, fixture assetMediaFixture) (Asset, FileOperation) {
	test.Helper()
	id := identifier()
	asset := Asset{ID: id, UserID: "owner", Kind: strings.Split(fixture.mimeType, "/")[0], Title: "原件", MimeType: fixture.mimeType, Path: id, Bytes: int64(len(fixture.data)), SaveState: "saved", SyncState: "local", Metadata: JSON(`{}`)}
	if err := application.db.Create(&asset).Error; err != nil { test.Fatal(err) }
	name, err := application.assetOriginalPath(asset); if err != nil { test.Fatal(err) }; if err := os.WriteFile(name, fixture.data, 0600); err != nil { test.Fatal(err) }
	operation := FileOperation{ID: identifier(), AssetID: id, Kind: "repair_suffix", State: "queued", SourcePath: asset.Path}
	return asset, operation
}

func TestAssetFilenameRepairPreservesOriginalsAndReferences(test *testing.T) {
	application := assetFileTestApp(test)
	fixtures := append(assetMediaFixtures(test), assetMediaFixture{"pcm", "audio/pcm", ".pcm", make([]byte, 256)})
	for _, fixture := range fixtures {
		test.Run(fixture.name, func(test *testing.T) {
			asset, operation := assetRepairFixture(test, application, fixture)
			oldName, err := application.assetOriginalPath(asset); if err != nil { test.Fatal(err) }
			if err := application.db.Create(&operation).Error; err != nil { test.Fatal(err) }
			application.runAssetFilenameRepair(context.Background(), operation, suggestedPolicy())
			var repaired Asset; if err := application.db.First(&repaired, "id = ?", asset.ID).Error; err != nil { test.Fatal(err) }
			if repaired.Path != asset.ID+fixture.extension || repaired.MimeType != fixture.mimeType || repaired.Bytes != asset.Bytes || repaired.Title != asset.Title || repaired.SaveState != "saved" { test.Fatal("repair changed asset identity or original metadata") }
			name, err := application.assetOriginalPath(repaired); if err != nil { test.Fatal(err) }; data, err := os.ReadFile(name); if err != nil { test.Fatal(err) }; if !bytes.Equal(data, fixture.data) { test.Fatal("repair changed original bytes") }
			if _, err := os.Stat(oldName); !errors.Is(err, os.ErrNotExist) { test.Fatal("successful repair left the old local original") }
			if err := application.db.First(&operation, "id = ?", operation.ID).Error; err != nil { test.Fatal(err) }; if operation.State != "done" || operation.Error != "" || operation.SourcePath != asset.Path || operation.TargetPath != repaired.Path { test.Fatal("repair journal did not record completion") }
			response := httptest.NewRecorder(); assetFileTestRouter(application).ServeHTTP(response, httptest.NewRequest("GET", "/api/assets/"+asset.ID+"/file", nil))
			if response.Code != 200 || !bytes.Equal(response.Body.Bytes(), fixture.data) { test.Fatal("stable asset URL stopped serving the original") }
			application.runAssetFilenameRepair(context.Background(), operation, suggestedPolicy())
			if _, err := os.Stat(name); err != nil { test.Fatal("repeated repair removed the current original") }
		})
	}
}

func TestAssetFilenameRepairQueueIsExplicitScopedAndIdempotent(test *testing.T) {
	application := assetFileTestApp(test)
	if err := application.db.Model(&User{}).Where("id = ?", "owner").Update("role", "admin").Error; err != nil { test.Fatal(err) }
	fixture := assetMediaFixtures(test)[0]
	asset, _ := assetRepairFixture(test, application, fixture)
	other, _ := assetRepairFixture(test, application, fixture)
	if err := application.db.Model(&other).Update("user_id", "other").Error; err != nil { test.Fatal(err) }
	workbench, _ := assetRepairFixture(test, application, fixture)
	if err := application.db.Model(&workbench).Update("workbench_record_id", "record").Error; err != nil { test.Fatal(err) }
	removed, _ := assetRepairFixture(test, application, fixture)
	if err := application.db.Model(&removed).Update("delete_state", "pending").Error; err != nil { test.Fatal(err) }
	if err := application.db.Create(&Asset{ID: identifier(), UserID: "owner", Kind: "text", SaveState: "saved", Metadata: JSON(`{}`)}).Error; err != nil { test.Fatal(err) }
	if _, err := application.QueueAssetFilenameRepair(User{ID: "owner"}, false); err == nil { test.Fatal("repair queued without explicit confirmation") }
	if _, err := application.QueueAssetFilenameRepair(User{ID: "other"}, true); err == nil { test.Fatal("repair accepted a non-administrator") }
	count, err := application.QueueAssetFilenameRepair(User{ID: "owner"}, true); if err != nil { test.Fatal(err) }; if count != 2 { test.Fatal("repair did not respect account, media, save and deletion scope") }
	count, err = application.QueueAssetFilenameRepair(User{ID: "owner"}, true); if err != nil { test.Fatal(err) }; if count != 0 { test.Fatal("repeated repair duplicated jobs") }
	var operations []FileOperation; if err := application.db.Where("kind = ?", "repair_suffix").Find(&operations).Error; err != nil { test.Fatal(err) }
	for _, operation := range operations { if operation.AssetID != asset.ID && operation.AssetID != workbench.ID { test.Fatal("repair included another account or a removed asset") } }
}

func TestAssetFilenameRepairWaitsForLeasesAndBlocksOnlySwitching(test *testing.T) {
	application := assetFileTestApp(test)
	asset, operation := assetRepairFixture(test, application, assetMediaFixtures(test)[0])
	if err := application.db.Create(&operation).Error; err != nil { test.Fatal(err) }
	if err := application.db.Create(&TaskAsset{TaskID: "in-flight", AssetID: asset.ID}).Error; err != nil { test.Fatal(err) }
	application.runAssetFilenameRepair(context.Background(), operation, suggestedPolicy())
	if err := application.db.First(&operation, "id = ?", operation.ID).Error; err != nil { test.Fatal(err) }; if operation.State != "queued" || operation.Error != "" || operation.NextRunAt == nil { test.Fatal("active task was not deferred without failure") }
	var original Asset; if err := application.db.First(&original, "id = ?", asset.ID).Error; err != nil { test.Fatal(err) }; if original.Path != asset.Path { test.Fatal("repair changed a file used by an active task") }
	if err := application.db.Model(&TaskAsset{}).Where("asset_id = ?", asset.ID).Update("released", true).Error; err != nil { test.Fatal(err) }
	if err := application.db.Model(&operation).Update("state", "running").Error; err != nil { test.Fatal(err) }
	if err := claimTaskAsset(application.db, TaskAsset{TaskID: "new-task", AssetID: asset.ID}); err == nil { test.Fatal("a new task acquired a file during its filename switch") }
	application.runAssetFilenameRepair(context.Background(), operation, suggestedPolicy())
	if err := claimTaskAsset(application.db, TaskAsset{TaskID: "new-task", AssetID: asset.ID}); err != nil { test.Fatal("completed repair did not release the task gate") }
}

func TestAssetFilenameRepairResumesReservedPartialFile(test *testing.T) {
	application := assetFileTestApp(test)
	fixture := assetMediaFixtures(test)[0]
	asset, operation := assetRepairFixture(test, application, fixture)
	operation.State, operation.TargetPath = "running", asset.ID+fixture.extension
	if err := application.db.Create(&operation).Error; err != nil { test.Fatal(err) }
	target := asset; target.Path = operation.TargetPath
	name, err := application.assetOriginalPath(target); if err != nil { test.Fatal(err) }; if err := os.WriteFile(name, []byte("interrupted copy"), 0600); err != nil { test.Fatal(err) }
	application.runAssetFilenameRepair(context.Background(), operation, suggestedPolicy())
	data, err := os.ReadFile(name); if err != nil { test.Fatal(err) }; if !bytes.Equal(data, fixture.data) { test.Fatal("restart did not replace its reserved partial copy with the full original") }
	if err := application.db.First(&operation, "id = ?", operation.ID).Error; err != nil { test.Fatal(err) }; if operation.State != "done" { test.Fatal("resumed repair did not finish") }
}

func TestAssetFilenameRepairNeverOverwritesUnknownTarget(test *testing.T) {
	application := assetFileTestApp(test)
	fixture := assetMediaFixtures(test)[0]
	asset, operation := assetRepairFixture(test, application, fixture)
	if err := application.db.Create(&operation).Error; err != nil { test.Fatal(err) }
	target := asset; target.Path = asset.ID+fixture.extension
	name, err := application.assetOriginalPath(target); if err != nil { test.Fatal(err) }; if err := os.WriteFile(name, []byte("unrelated"), 0600); err != nil { test.Fatal(err) }
	application.runAssetFilenameRepair(context.Background(), operation, suggestedPolicy())
	data, err := os.ReadFile(name); if err != nil { test.Fatal(err) }; if string(data) != "unrelated" { test.Fatal("repair overwrote an unclaimed existing file") }
	if err := application.db.First(&operation, "id = ?", operation.ID).Error; err != nil { test.Fatal(err) }; if operation.State != "queued" || operation.Error == "" || operation.TargetPath != "" { test.Fatal("conflicting target did not remain a visible, non-destructive failure") }
}

func TestAssetFilenameRepairSkipsCorrectNamesAndReportsMissingFiles(test *testing.T) {
	application := assetFileTestApp(test)
	fixture := assetMediaFixtures(test)[0]
	asset, operation := assetRepairFixture(test, application, fixture)
	oldName, err := application.assetOriginalPath(asset); if err != nil { test.Fatal(err) }
	asset.Path += fixture.extension
	name, err := application.assetOriginalPath(asset); if err != nil { test.Fatal(err) }; if err := os.Rename(oldName, name); err != nil { test.Fatal(err) }
	if err := application.db.Model(&asset).Update("path", asset.Path).Error; err != nil { test.Fatal(err) }
	operation.SourcePath = asset.Path
	if err := application.db.Create(&operation).Error; err != nil { test.Fatal(err) }
	application.runAssetFilenameRepair(context.Background(), operation, suggestedPolicy())
	if err := application.db.First(&operation, "id = ?", operation.ID).Error; err != nil { test.Fatal(err) }; if operation.State != "done" || operation.SourcePath != operation.TargetPath { test.Fatal("correct original was not skipped") }
	data, err := os.ReadFile(name); if err != nil { test.Fatal(err) }; if !bytes.Equal(data, fixture.data) { test.Fatal("correct original was modified") }
	missing, pending := assetRepairFixture(test, application, fixture)
	missingName, err := application.assetOriginalPath(missing); if err != nil { test.Fatal(err) }; if err := os.Remove(missingName); err != nil { test.Fatal(err) }
	if err := application.db.Create(&pending).Error; err != nil { test.Fatal(err) }
	application.runAssetFilenameRepair(context.Background(), pending, suggestedPolicy())
	if err := application.db.First(&pending, "id = ?", pending.ID).Error; err != nil { test.Fatal(err) }; if pending.State != "queued" || pending.Error == "" || pending.TargetPath != "" { test.Fatal("missing original was not reported without changing its reference") }
}

func TestAssetFilenameRepairAllowsConfirmedDeletionAfterFailedCopy(test *testing.T) {
	application := assetFileTestApp(test)
	fixture := assetMediaFixtures(test)[0]
	asset, operation := assetRepairFixture(test, application, fixture)
	operation.TargetPath = asset.ID+fixture.extension
	if err := application.db.Create(&operation).Error; err != nil { test.Fatal(err) }
	unused := asset; unused.Path = operation.TargetPath
	name, err := application.assetOriginalPath(unused); if err != nil { test.Fatal(err) }; if err := os.WriteFile(name, []byte("incomplete copy"), 0600); err != nil { test.Fatal(err) }
	if err := application.db.Model(&asset).Update("delete_state", "pending").Error; err != nil { test.Fatal(err) }
	application.runAssetFilenameRepair(context.Background(), operation, suggestedPolicy())
	if err := application.db.First(&operation, "id = ?", operation.ID).Error; err != nil { test.Fatal(err) }; if operation.State != "done" || operation.TargetPath != operation.SourcePath { test.Fatal("confirmed deletion did not retire the pending repair") }
	if _, err := os.Stat(name); !errors.Is(err, os.ErrNotExist) { test.Fatal("retired repair left an unused partial copy") }
	if err := application.cleanAsset(asset.ID); err != nil { test.Fatal(err) }
}

func TestAssetFilenameRepairCloudFailureAndCleanupResume(test *testing.T) {
	application := assetFileTestApp(test)
	fixture := assetMediaFixtures(test)[3]
	asset, operation := assetRepairFixture(test, application, fixture)
	if err := application.db.Model(&asset).Updates(map[string]any{"storage_id": "unavailable-storage", "sync_state": "synced"}).Error; err != nil { test.Fatal(err) }
	if err := application.db.Create(&operation).Error; err != nil { test.Fatal(err) }
	application.runAssetFilenameRepair(context.Background(), operation, suggestedPolicy())
	var recorded Asset; if err := application.db.First(&recorded, "id = ?", asset.ID).Error; err != nil { test.Fatal(err) }; if recorded.Path != asset.Path || recorded.SyncState != "synced" { test.Fatal("cloud upload failure replaced a working original reference") }
	if err := application.db.First(&operation, "id = ?", operation.ID).Error; err != nil { test.Fatal(err) }; if operation.State != "queued" || operation.Error == "" { test.Fatal("cloud failure was not durably recorded") }
	target := asset; target.Path = asset.ID+fixture.extension
	name, err := application.assetOriginalPath(target); if err != nil { test.Fatal(err) }; data, err := os.ReadFile(name); if err != nil { test.Fatal(err) }; if !bytes.Equal(data, fixture.data) { test.Fatal("cloud failure did not preserve the prepared copy") }
	if err := application.db.Model(&Asset{}).Where("id = ?", asset.ID).Update("path", target.Path).Error; err != nil { test.Fatal(err) }
	if err := application.db.Model(&FileOperation{}).Where("id = ?", operation.ID).Update("state", "cleanup").Error; err != nil { test.Fatal(err) }
	application.runAssetFilenameRepair(context.Background(), operation, suggestedPolicy())
	if err := application.db.First(&operation, "id = ?", operation.ID).Error; err != nil { test.Fatal(err) }; if operation.State != "cleanup" || operation.Error == "" { test.Fatal("old-cloud cleanup failure was not durably recorded") }
	if err := application.db.Model(&Asset{}).Where("id = ?", asset.ID).Update("delete_state", "pending").Error; err != nil { test.Fatal(err) }; if err := application.cleanAsset(asset.ID); err == nil { test.Fatal("global deletion bypassed the old-copy cleanup journal") }
	oldName, err := application.assetOriginalPath(asset); if err != nil { test.Fatal(err) }; if _, err := os.Stat(oldName); err != nil { test.Fatal("cloud cleanup failure removed the local old copy") }
	if err := application.db.Model(&Asset{}).Where("id = ?", asset.ID).Update("storage_id", "").Error; err != nil { test.Fatal(err) }
	application.runAssetFilenameRepair(context.Background(), operation, suggestedPolicy())
	if err := application.db.First(&operation, "id = ?", operation.ID).Error; err != nil { test.Fatal(err) }; if operation.State != "done" || operation.Error != "" { test.Fatal("cleanup did not resume to completion") }
	if _, err := os.Stat(oldName); !errors.Is(err, os.ErrNotExist) { test.Fatal("resumed cleanup left the old local copy") }
	data, err = os.ReadFile(name); if err != nil { test.Fatal(err) }; if !bytes.Equal(data, fixture.data) { test.Fatal("cleanup changed the current original") }
}
