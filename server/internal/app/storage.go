package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/aliyun/aliyun-oss-go-sdk/oss"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/gin-gonic/gin"
	cos "github.com/tencentyun/cos-go-sdk-v5"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func (a *App) listStorages(c *gin.Context) {
	value, err := a.ListStorages(); if err != nil { respondError(c, err); return }; c.JSON(200, value)
}

func (a *App) ListStorages() ([]gin.H, error) {
	rows := []ObjectStorage{}
	if err := a.db.Order("created_at").Find(&rows).Error; err != nil { return nil, err }
	result := []gin.H{}
	for _, row := range rows { result = append(result, gin.H{"storage": row, "hasCredential": row.Secret != "" && row.AccessKeyID != ""}) }
	return result, nil
}

type storageInput struct { Name string `json:"name"`; Provider string `json:"provider"`; Region string `json:"region"`; PathStyle bool `json:"pathStyle"`; Endpoint string `json:"endpoint"`; Bucket string `json:"bucket"`; AccessKeyID string `json:"accessKeyId"`; AccessKeySecret string `json:"accessKeySecret"`; Default bool `json:"default"`; Version uint64 `json:"version"` }

func (a *App) saveStorage(c *gin.Context) {
	var input storageInput; if !bind(c, &input) { return }; value, err := a.SaveStorage(c.Param("id"), input); if err != nil { respondError(c, err); return }; c.JSON(200, value)
}

func validateStorageInput(input storageInput) (*url.URL, error) {
	if !includes([]string{"r2", "aliyun", "tencent", "qiniu", "s3"}, input.Provider) || input.Region == "" { return nil, problem(400, "invalid_storage", "请选择存储类型并填写区域") }
	u, err := url.Parse(strings.TrimSpace(input.Endpoint))
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" && u.Path != "/" { return nil, problem(400, "invalid_storage", "OSS Endpoint 需要 HTTPS 服务地址，不包含路径、查询或凭据") }
	if strings.TrimSpace(input.Name) == "" || strings.TrimSpace(input.Bucket) == "" || strings.ContainsAny(input.Bucket, "/\\ ?#") { return nil, problem(400, "invalid_storage", "请填写存储名称和有效 Bucket") }
	if input.Provider == "r2" && input.Region != "auto" { return nil, problem(400, "invalid_region", "Cloudflare R2 的区域需要填写 auto") }
	if (input.Provider == "aliyun" || input.Provider == "tencent") && input.PathStyle { return nil, problem(400, "invalid_addressing", "阿里云 OSS 与腾讯云 COS 模板使用原生虚拟主机寻址，请关闭 Path Style") }
	return u, nil
}

func (a *App) SaveStorage(id string, input storageInput) (gin.H, error) {
	u, err := validateStorageInput(input); if err != nil { return nil, err }
	row := ObjectStorage{}
	err = a.db.Transaction(func(tx *gorm.DB) error {
		if id != "" { if err := tx.First(&row, "id = ?", id).Error; err != nil { return err }; if row.Version != input.Version { return problem(409, "version_conflict", "存储配置已更新，请重新读取") }
			if row.Endpoint != u.String() || row.Bucket != input.Bucket || row.Provider != input.Provider || row.Region != input.Region || row.PathStyle != input.PathStyle { used, err := storageInUse(tx, row.ID); if err != nil { return err }; if used { return problem(409, "storage_in_use", "资产或待处理迁移仍引用此存储；请新建配置再迁移") } }
		} else { row.ID = identifier() }
		row.Name, row.Endpoint, row.Bucket, row.Default, row.Version = strings.TrimSpace(input.Name), u.String(), input.Bucket, input.Default, input.Version+1
		row.Provider, row.Region, row.PathStyle = input.Provider, input.Region, input.PathStyle
		if input.AccessKeyID != "" { value, err := a.encryptSecret(input.AccessKeyID); if err != nil { return err }; row.AccessKeyID = value }
		if input.AccessKeySecret != "" { value, err := a.encryptSecret(input.AccessKeySecret); if err != nil { return err }; row.Secret = value }
		if row.AccessKeyID == "" || row.Secret == "" { return problem(400, "credential_required", "请填写 OSS AccessKey ID 和 Secret") }
		if row.Default { if err := tx.Model(&ObjectStorage{}).Where("id <> ? AND `default` = ?", row.ID, true).Updates(map[string]any{"default": false, "version": gorm.Expr("version + 1")}).Error; err != nil { return err } }
		return tx.Save(&row).Error
	})
	if err != nil { return nil, err }
	a.signalWork(); a.notifyCatalog(); return gin.H{"storage": row, "hasCredential": true}, nil
}

func (a *App) deleteStorage(c *gin.Context) {
	if err := a.DeleteStorage(c.Param("id")); err != nil { respondError(c, err); return }; c.Status(204)
}

func (a *App) DeleteStorage(id string) error {
	return a.db.Transaction(func(tx *gorm.DB) error {
		used, err := storageInUse(tx, id); if err != nil { return err }
		if used { return problem(409, "storage_in_use", "仍有资产、迁移或待删除文件引用此存储，不能移除") }
		return tx.Delete(&ObjectStorage{}, "id = ?", id).Error
	})
}

func (a *App) storageBucket(id string, policy executionPolicy) (*oss.Bucket, error) {
	var storage ObjectStorage
	if err := a.db.First(&storage, "id = ?", id).Error; err != nil { return nil, err }
	return a.ossBucket(storage, policy)
}

func (a *App) ossBucket(storage ObjectStorage, policy executionPolicy) (*oss.Bucket, error) {
	key, err := a.decryptSecret(storage.AccessKeyID); if err != nil { return nil, err }
	secret, err := a.decryptSecret(storage.Secret); if err != nil { return nil, err }
	client, err := oss.New(storage.Endpoint, key, secret, oss.HTTPClient(providerHTTP(policy)), oss.Timeout(int64(policy.ConnectSeconds), int64(policy.TransferSeconds)))
	if err != nil { return nil, err }
	client.Config.RetryTimes = 0
	return client.Bucket(storage.Bucket)
}

func storageKey(asset Asset) string { return "assets/"+asset.UserID+"/"+asset.Path }

func (a *App) s3Client(storage ObjectStorage, policy executionPolicy) (*s3.Client, error) {
	key, err := a.decryptSecret(storage.AccessKeyID); if err != nil { return nil, err }
	secret, err := a.decryptSecret(storage.Secret); if err != nil { return nil, err }
	return s3.New(s3.Options{Region: storage.Region, BaseEndpoint: aws.String(storage.Endpoint), Credentials: credentials.NewStaticCredentialsProvider(key, secret, ""), UsePathStyle: storage.PathStyle, HTTPClient: providerHTTP(policy), Retryer: aws.NopRetryer{}, RequestChecksumCalculation: aws.RequestChecksumCalculationWhenRequired, ResponseChecksumValidation: aws.ResponseChecksumValidationWhenRequired}), nil
}

func (a *App) cosClient(storage ObjectStorage, policy executionPolicy) (*cos.Client, error) {
	key, err := a.decryptSecret(storage.AccessKeyID); if err != nil { return nil, err }
	secret, err := a.decryptSecret(storage.Secret); if err != nil { return nil, err }
	address, err := url.Parse(storage.Endpoint); if err != nil { return nil, err }
	address.Host = storage.Bucket+"."+address.Host
	clientHTTP := providerHTTP(policy)
	clientHTTP.Transport = &cos.AuthorizationTransport{SecretID: key, SecretKey: secret, Transport: clientHTTP.Transport}
	client := cos.NewClient(&cos.BaseURL{BucketURL: address}, clientHTTP)
	client.Conf.RetryOpt.Count = 0
	return client, nil
}

func (a *App) signAsset(asset Asset, policy executionPolicy) (string, error) {
	var storage ObjectStorage
	if err := a.db.First(&storage, "id = ?", asset.StorageID).Error; err != nil { return "", err }
	return a.signStorageObject(a.ctx, storage, storageKey(asset), policy)
}

func (a *App) signStorageObject(ctx context.Context, storage ObjectStorage, key string, policy executionPolicy) (string, error) {
	if storage.Provider == "aliyun" { bucket, err := a.ossBucket(storage, policy); if err != nil { return "", err }; return bucket.SignURL(key, oss.HTTPGet, int64(policy.SignedURLSeconds)) }
	if storage.Provider == "tencent" { client, err := a.cosClient(storage, policy); if err != nil { return "", err }; address, err := client.Object.GetPresignedURL2(ctx, http.MethodGet, key, seconds(policy.SignedURLSeconds), nil); if err != nil { return "", err }; return address.String(), nil }
	client, err := a.s3Client(storage, policy); if err != nil { return "", err }
	result, err := s3.NewPresignClient(client).PresignGetObject(ctx, &s3.GetObjectInput{Bucket: aws.String(storage.Bucket), Key: aws.String(key)}, s3.WithPresignExpires(seconds(policy.SignedURLSeconds)))
	if err != nil { return "", err }; return result.URL, nil
}

func (a *App) putCloudAsset(ctx context.Context, asset Asset, file *os.File, policy executionPolicy) error {
	var storage ObjectStorage
	if err := a.db.First(&storage, "id = ?", asset.StorageID).Error; err != nil { return err }
	if storage.Provider == "aliyun" { bucket, err := a.storageBucket(storage.ID, policy); if err != nil { return err }; return bucket.PutObject(storageKey(asset), file, oss.ContentType(asset.MimeType), oss.ObjectACL(oss.ACLPrivate), oss.WithContext(ctx)) }
	if storage.Provider == "tencent" { client, err := a.cosClient(storage, policy); if err != nil { return err }; _, err = client.Object.Put(ctx, storageKey(asset), file, &cos.ObjectPutOptions{ObjectPutHeaderOptions: &cos.ObjectPutHeaderOptions{ContentType: asset.MimeType, ContentLength: asset.Bytes}, ACLHeaderOptions: &cos.ACLHeaderOptions{XCosACL: "private"}}); return err }
	client, err := a.s3Client(storage, policy); if err != nil { return err }
	_, err = client.PutObject(ctx, &s3.PutObjectInput{Bucket: aws.String(storage.Bucket), Key: aws.String(storageKey(asset)), Body: file, ContentLength: aws.Int64(asset.Bytes), ContentType: aws.String(asset.MimeType)})
	return err
}

func (a *App) deleteCloudAsset(ctx context.Context, asset Asset, policy executionPolicy) error {
	if asset.StorageID == "" { return nil }
	var storage ObjectStorage
	if err := a.db.First(&storage, "id = ?", asset.StorageID).Error; err != nil { return err }
	if storage.Provider == "aliyun" { bucket, err := a.storageBucket(storage.ID, policy); if err != nil { return err }; return bucket.DeleteObject(storageKey(asset), oss.WithContext(ctx)) }
	if storage.Provider == "tencent" { client, err := a.cosClient(storage, policy); if err != nil { return err }; _, err = client.Object.Delete(ctx, storageKey(asset), nil); return err }
	client, err := a.s3Client(storage, policy); if err != nil { return err }
	_, err = client.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: aws.String(storage.Bucket), Key: aws.String(storageKey(asset))}); return err
}

func (a *App) queueAssetSync(id string) error {
	queued := false
	err := a.db.Transaction(func(tx *gorm.DB) error {
		var asset Asset
		if err := tx.First(&asset, "id = ?", id).Error; err != nil { return err }
		if asset.Kind == "text" || asset.SaveState != "saved" || asset.SyncState == "synced" { return nil }
		if asset.DeleteState != "" { var active int64; if err := tx.Model(&TaskAsset{}).Where("asset_id = ? AND released = ?", id, false).Count(&active).Error; err != nil { return err }; if active == 0 { return nil } }
		var pending int64; if err := tx.Model(&FileOperation{}).Where("asset_id = ? AND kind IN ?", id, []string{"sync", "migrate"}).Count(&pending).Error; err != nil { return err }; if pending > 0 { return nil }
		if asset.StorageID == "" {
			var storage ObjectStorage
			err := tx.First(&storage, "`default` = ?", true).Error
			if errors.Is(err, gorm.ErrRecordNotFound) { return nil }; if err != nil { return err }
			if err := tx.Model(&asset).Update("storage_id", storage.ID).Error; err != nil { return err }
		}
		if err := tx.Model(&asset).Update("sync_state", "pending").Error; err != nil { return err }
		result := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&FileOperation{ID: identifier(), AssetID: asset.ID, Kind: "sync"}); queued = result.RowsAffected > 0; return result.Error
	})
	if err == nil && queued { a.signalWork() }
	return err
}

func (a *App) assetTaskURL(userID, id string, policy executionPolicy) (string, error) {
	var asset Asset
	if err := a.db.First(&asset, "id = ? AND user_id = ? AND save_state = ?", id, userID, "saved").Error; err != nil { return "", err }
	// An already accepted task holds a durable TaskAsset lease even after deletion is requested.
	if asset.SyncState == "synced" && asset.StorageID != "" {
		return a.signAsset(asset, policy)
	}
	return "", problem(409, "asset_not_synced", "HTTPS 参考素材尚未同步到私有 OSS，任务不会提交")
}

func (a *App) prepareCloudInputs(userID string, snapshot executionSnapshot, input generationInput) (bool, error) {
	var controls []parameterControl; _ = json.Unmarshal(snapshot.Model.Parameters, &controls)
	parameters := map[string]any{}; _ = json.Unmarshal(input.Parameters, &parameters)
	cloudAssets := map[string]bool{}
	for _, reference := range input.References { for _, control := range materialControls(controls, parameters, reference) { if control.Transport == "https" || control.Transport == "" { cloudAssets[reference.AssetID] = true } } }
	ready := true
	for _, reference := range input.References {
		if !cloudAssets[reference.AssetID] { continue }
		var asset Asset
		if err := a.db.First(&asset, "id = ? AND user_id = ?", reference.AssetID, userID).Error; err != nil { return false, err }
		if asset.SyncState == "synced" { continue }
		if err := a.queueAssetSync(asset.ID); err != nil { return false, err }
		if err := a.db.First(&asset, "id = ?", asset.ID).Error; err != nil { return false, err }
		if asset.StorageID == "" { var migrating int64; if err := a.db.Model(&FileOperation{}).Where("asset_id = ? AND kind = ?", asset.ID, "migrate").Count(&migrating).Error; err != nil { return false, err }; if migrating == 0 { return false, problem(409, "storage_required", "此模型参考素材需要私有 OSS，请先配置存储") } }
		ready = false
	}
	return ready, nil
}

func (a *App) prepareTaskAssets(task GenerationTask, snapshot executionSnapshot, input generationInput) (bool, error) {
	ready, err := a.prepareCloudInputs(task.UserID, snapshot, input); if err != nil || ready { return ready, err }
	if err := a.db.Model(&GenerationTask{}).Where("id = ? AND status IN ?", task.ID, []string{"queued", "waiting_assets"}).Updates(map[string]any{"status": "waiting_assets", "next_run_at": time.Now().Add(seconds(snapshot.Policy.PollSeconds)), "error": "等待私有参考素材同步；未提交供应商"}).Error; err != nil { return false, err }
	a.notify(task.UserID); a.signalWork(); return false, nil
}

func (a *App) dispatchFiles() {
	policy, err := a.executionPolicy(); if err != nil { return }
	var rows []FileOperation
	if a.db.Where("kind IN ? AND (next_run_at IS NULL OR next_run_at <= ?) AND (kind <> ? OR NOT EXISTS (SELECT 1 FROM task_assets WHERE task_assets.asset_id = file_operations.asset_id AND released = ?)) AND (kind <> ? OR EXISTS (SELECT 1 FROM assets WHERE assets.id = file_operations.asset_id AND (assets.delete_state = ? OR (assets.delete_state = ? AND assets.sync_state <> ? AND EXISTS (SELECT 1 FROM task_assets WHERE task_assets.asset_id = assets.id AND released = ?)))))", []string{"sync", "delete", "migrate"}, time.Now(), "delete", false, "migrate", "", "pending", "synced", false).Order("created_at").Find(&rows).Error != nil { return }
	active := 0; a.workMu.Lock(); for key := range a.active { if strings.HasPrefix(key, "file:") { active++ } }; a.workMu.Unlock()
	for _, row := range rows { if active >= policy.TransferSlots { break }; if a.launch("file:"+row.AssetID, func(ctx context.Context) { a.runFileOperation(ctx, row) }) { active++ } }
}

func (a *App) runFileOperation(ctx context.Context, operation FileOperation) {
	if err := a.db.First(&operation, "id = ?", operation.ID).Error; err != nil { return }
	ctx = withLogContext(ctx, slog.String("operation_id", operation.ID), slog.String("asset_id", operation.AssetID), slog.String("operation", operation.Kind))
	a.logEvent(ctx, slog.LevelDebug, "asset.operation_started", slog.Int("attempt", operation.Attempts+1))
	policy, err := a.executionPolicy(); if err != nil { return }
	ctx, cancel := context.WithTimeout(ctx, seconds(policy.TransferSeconds)); defer cancel()
	var asset Asset
	if err := a.db.First(&asset, "id = ?", operation.AssetID).Error; err != nil { if errors.Is(err, gorm.ErrRecordNotFound) { if a.db.Delete(&FileOperation{}, "id = ?", operation.ID).Error == nil { a.signalWork() } }; return }
	if operation.Kind == "migrate" {
		var complete bool
		complete, err = a.runAssetMigration(ctx, operation, policy)
		if err == nil && !complete { return }
	} else if operation.Kind == "delete" { err = a.cleanAsset(asset.ID)
	} else if asset.DeleteState == "deleted" { err = nil
	} else {
		{
			release, acquireErr := a.acquireFile(ctx, false, false); if acquireErr != nil { return }; defer release()
			a.assetFiles.RLock(); defer a.assetFiles.RUnlock()
			if a.db.First(&asset, "id = ?", asset.ID).Error != nil { return }
			if asset.DeleteState != "" { var active int64; if a.db.Model(&TaskAsset{}).Where("asset_id = ? AND released = ?", asset.ID, false).Count(&active).Error != nil { return }; if active == 0 { if a.db.Delete(&FileOperation{}, "id = ?", operation.ID).Error == nil { a.signalWork() }; return } }
			a.db.Model(&asset).Update("sync_state", "syncing"); a.notify(asset.UserID)
			name, pathErr := a.assetOriginalPath(asset)
			err = pathErr
			if err == nil { var file *os.File; file, err = os.Open(name); if err == nil { err = a.putCloudAsset(ctx, asset, file, policy); file.Close() } }
			if err == nil { err = a.db.Model(&Asset{}).Where("id = ? AND delete_state <> ?", asset.ID, "deleted").Updates(map[string]any{"sync_state": "synced", "error": ""}).Error }
		}
	}
	if err == nil {
		if removeErr := a.db.Delete(&FileOperation{}, "id = ?", operation.ID).Error; removeErr != nil { a.logFailure(ctx, "asset.operation_save_failed", removeErr) } else { a.logEvent(ctx, slog.LevelInfo, "asset.operation_completed"); a.signalWork() }
	} else {
		a.logFailure(ctx, "asset.operation_failed", err, slog.Int("attempt", operation.Attempts+1))
		index := operation.Attempts
		if index >= len(policy.StorageRetrySeconds) { index = len(policy.StorageRetrySeconds)-1 }
		next := time.Now().Add(seconds(policy.StorageRetrySeconds[index]))
		message := "云同步失败，本地原件仍保留，后台将按配置继续处理"
		if operation.Kind == "delete" {
			message = "文件仍待删除，后台将按配置继续清理"
			var current Asset
			if a.db.First(&current, "id = ?", asset.ID).Error == nil && current.Error != "" { message = current.Error }
		} else if operation.Kind == "migrate" { message = "存储迁移未完成，现有原件仍保留，后台将继续重试复制或清理旧副本"; if code, status := storageTestFailure(err); status > 0 { message += "（存储服务返回 HTTP "+fmt.Sprint(status)+"）" } else if code == "timeout" { message += "（请求超时）" } else if code == "asset_size_changed" { message = "服务器原件大小与资产记录不符，未切换存储；请检查文件完整性后重试" } } else { a.db.Model(&asset).Update("sync_state", "failed") }
		if operation.Kind != "migrate" { a.db.Model(&asset).Update("error", message) }
		if a.db.Model(&operation).Updates(map[string]any{"attempts": operation.Attempts+1, "next_run_at": next, "error": message}).Error == nil { a.signalWork() }
	}
	a.refreshTaskSync(asset.ID); a.notify(asset.UserID)
}

func (a *App) refreshTaskSync(assetID string) {
	var tasks []GenerationTask
	if a.db.Where("EXISTS (SELECT 1 FROM json_each(generation_tasks.asset_ids) WHERE json_each.value = ?)", assetID).Find(&tasks).Error != nil { return }
	for _, task := range tasks {
		var ids []string; if json.Unmarshal(task.AssetIDs, &ids) != nil || !includes(ids, assetID) { continue }
		state := "synced"
		for _, id := range ids { var asset Asset; if a.db.First(&asset, "id = ?", id).Error != nil { state = "failed"; break }; if asset.SyncState != "synced" { state = asset.SyncState; break } }
		a.db.Model(&task).Update("sync_state", state)
	}
}
