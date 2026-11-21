package app

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/aliyun/aliyun-oss-go-sdk/oss"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/gin-gonic/gin"
	cos "github.com/tencentyun/cos-go-sdk-v5"
)

type storageTestInput struct { StorageID string `json:"storageId"`; Config storageInput `json:"config"` }
type storageTestResult struct {
	Success bool `json:"success"`
	Stage string `json:"stage"`
	Code string `json:"code,omitempty"`
	HTTPStatus int `json:"httpStatus,omitempty"`
	CleanupRequired bool `json:"cleanupRequired,omitempty"`
	CleanupCode string `json:"cleanupCode,omitempty"`
	CleanupHTTPStatus int `json:"cleanupHttpStatus,omitempty"`
	ObjectKey string `json:"objectKey,omitempty"`
	VersionID string `json:"versionId,omitempty"`
}

func (a *App) testStorage(c *gin.Context) {
	var input storageTestInput; if !bind(c, &input) { return }
	value, err := a.TestStorage(c.Request.Context(), currentUser(c), input.StorageID, input.Config)
	if err != nil { respondError(c, err); return }; c.JSON(200, value)
}

func (a *App) TestStorage(parent context.Context, user User, id string, input storageInput) (result storageTestResult, err error) {
	if user.Role != "admin" { return result, problem(403, "forbidden", "需要管理员权限") }
	u, err := validateStorageInput(input); if err != nil { return result, err }
	storage := ObjectStorage{}
	if id != "" {
		if err := a.db.First(&storage, "id = ?", id).Error; err != nil { return result, err }
		if storage.Version != input.Version { return result, problem(409, "version_conflict", "存储配置已更新，请重新读取") }
		if storage.Provider != input.Provider { return result, problem(400, "invalid_storage", "已有配置不能更换存储服务商") }
	}
	storage.Name, storage.Provider, storage.Endpoint, storage.Bucket, storage.Region, storage.PathStyle = input.Name, input.Provider, u.String(), input.Bucket, input.Region, input.PathStyle
	if value := strings.TrimSpace(input.AccessKeyID); value != "" { storage.AccessKeyID, err = a.encryptSecret(value); if err != nil { return result, err } }
	if value := strings.TrimSpace(input.AccessKeySecret); value != "" { storage.Secret, err = a.encryptSecret(value); if err != nil { return result, err } }
	if storage.AccessKeyID == "" || storage.Secret == "" { return result, problem(400, "credential_required", "请填写对象存储的访问密钥") }
	policy, err := a.executionPolicy(); if err != nil { return result, err }
	release, err := a.acquireFile(parent, false, false); if err != nil { return result, err }; defer release()
	ctx, cancel := context.WithTimeout(parent, seconds(policy.QuerySeconds)); defer cancel()
	key := "assets/"+user.ID+"/.storage-test-"+identifier()+".txt"
	data := []byte("Dream Canvas object storage test\n"+identifier())
	versionID := ""
	// Cleanup must still run if the browser disconnects or the probe times out.
	defer func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(a.ctx, seconds(policy.QuerySeconds)); defer cleanupCancel()
		if cleanupErr := a.deleteStorageTestObject(cleanupCtx, storage, key, versionID, policy); cleanupErr != nil {
			result.Success, result.CleanupRequired, result.ObjectKey, result.VersionID = false, true, key, versionID
			result.CleanupCode, result.CleanupHTTPStatus = storageTestFailure(cleanupErr)
			if result.Stage == "completed" { result.Stage, result.Code, result.HTTPStatus = "delete", result.CleanupCode, result.CleanupHTTPStatus }
		} else if result.Stage == "write" && versionID == "" && (result.HTTPStatus == 0 || result.HTTPStatus >= 500) {
			// A lost upload response may hide a version ID; deleting the current key
			// alone cannot prove that a versioned object has been removed.
			result.CleanupRequired, result.ObjectKey, result.CleanupCode = true, key, "write_uncertain"
		}
	}()
	result.Stage = "write"
	versionID, err = a.putStorageTestObject(ctx, storage, key, data, policy)
	if err != nil { result.Code, result.HTTPStatus = storageTestFailure(err); return result, nil }
	result.Stage = "read"
	address, err := a.signStorageObject(ctx, storage, key, policy)
	if err != nil { result.Code, result.HTTPStatus = storageTestFailure(err); return result, nil }
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, address, nil)
	if err != nil { result.Code = "request_failed"; return result, nil }
	response, err := providerHTTP(policy).Do(request)
	if err != nil { result.Code, result.HTTPStatus = storageTestFailure(err); return result, nil }
	if response.StatusCode != http.StatusOK { response.Body.Close(); result.Code, result.HTTPStatus = "provider_http", response.StatusCode; return result, nil }
	actual, readErr := io.ReadAll(io.LimitReader(response.Body, int64(len(data))+1)); response.Body.Close()
	if readErr != nil { result.Code, result.HTTPStatus = storageTestFailure(readErr); return result, nil }
	result.Stage = "verify"
	if !bytes.Equal(actual, data) { result.Code = "content_mismatch"; return result, nil }
	result.Success, result.Stage = true, "completed"
	return result, nil
}

// Never return SDK error messages: they can contain credentials or signed URLs.
func storageTestFailure(err error) (string, int) {
	if errors.Is(err, context.DeadlineExceeded) { return "timeout", 0 }
	if errors.Is(err, context.Canceled) { return "cancelled", 0 }
	var rejected *Problem; if errors.As(err, &rejected) { return rejected.Code, 0 }
	var aliyun oss.ServiceError; if errors.As(err, &aliyun) { return "provider_http", aliyun.StatusCode }
	var tencent *cos.ErrorResponse; if errors.As(err, &tencent) && tencent.Response != nil { return "provider_http", tencent.Response.StatusCode }
	var status interface { HTTPStatusCode() int }; if errors.As(err, &status) { return "provider_http", status.HTTPStatusCode() }
	return "request_failed", 0
}

func (a *App) putStorageTestObject(ctx context.Context, storage ObjectStorage, key string, data []byte, policy executionPolicy) (string, error) {
	if storage.Provider == "aliyun" {
		bucket, err := a.ossBucket(storage, policy); if err != nil { return "", err }
		var header http.Header
		err = bucket.PutObject(key, bytes.NewReader(data), oss.ContentType("text/plain"), oss.ObjectACL(oss.ACLPrivate), oss.WithContext(ctx), oss.GetResponseHeader(&header))
		return header.Get("X-Oss-Version-Id"), err
	}
	if storage.Provider == "tencent" {
		client, err := a.cosClient(storage, policy); if err != nil { return "", err }
		response, err := client.Object.Put(ctx, key, bytes.NewReader(data), &cos.ObjectPutOptions{ObjectPutHeaderOptions: &cos.ObjectPutHeaderOptions{ContentType: "text/plain", ContentLength: int64(len(data))}, ACLHeaderOptions: &cos.ACLHeaderOptions{XCosACL: "private"}})
		if response != nil { return response.Header.Get("X-Cos-Version-Id"), err }; return "", err
	}
	client, err := a.s3Client(storage, policy); if err != nil { return "", err }
	response, err := client.PutObject(ctx, &s3.PutObjectInput{Bucket: aws.String(storage.Bucket), Key: aws.String(key), Body: bytes.NewReader(data), ContentLength: aws.Int64(int64(len(data))), ContentType: aws.String("text/plain")})
	if response != nil { return aws.ToString(response.VersionId), err }; return "", err
}

func (a *App) deleteStorageTestObject(ctx context.Context, storage ObjectStorage, key, versionID string, policy executionPolicy) error {
	if storage.Provider == "aliyun" {
		bucket, err := a.ossBucket(storage, policy); if err != nil { return err }
		options := []oss.Option{oss.WithContext(ctx)}; if versionID != "" { options = append(options, oss.VersionId(versionID)) }
		return bucket.DeleteObject(key, options...)
	}
	if storage.Provider == "tencent" {
		client, err := a.cosClient(storage, policy); if err != nil { return err }
		options := &cos.ObjectDeleteOptions{}
		if versionID != "" { query := url.Values{"versionId": []string{versionID}}; options.XOptionQuery = &query }
		_, err = client.Object.Delete(ctx, key, options); return err
	}
	client, err := a.s3Client(storage, policy); if err != nil { return err }
	input := &s3.DeleteObjectInput{Bucket: aws.String(storage.Bucket), Key: aws.String(key)}; if versionID != "" { input.VersionId = aws.String(versionID) }
	_, err = client.DeleteObject(ctx, input); return err
}
