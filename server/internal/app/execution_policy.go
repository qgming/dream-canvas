package app

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"math"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// No execution limits become product defaults until an administrator saves them.
type executionPolicy struct {
	Enabled bool `json:"enabled"`
	AssistantSlots int `json:"assistantSlots"`
	GenerationSlots int `json:"generationSlots"`
	UserSlots int `json:"userSlots"`
	TransferSlots int `json:"transferSlots"`
	PreviewSlots int `json:"previewSlots"`
	ConnectSeconds int `json:"connectSeconds"`
	QuerySeconds int `json:"querySeconds"`
	FirstResponseSeconds int `json:"firstResponseSeconds"`
	IdleSeconds int `json:"idleSeconds"`
	TextSeconds int `json:"textSeconds"`
	ImageSeconds int `json:"imageSeconds"`
	AudioSeconds int `json:"audioSeconds"`
	PollSeconds int `json:"pollSeconds"`
	QueryFailures int `json:"queryFailures"`
	MaxWaitSeconds int `json:"maxWaitSeconds"`
	TransferSeconds int `json:"transferSeconds"`
	DownloadRetrySeconds []int `json:"downloadRetrySeconds"`
	StorageRetrySeconds []int `json:"storageRetrySeconds"`
	SignedURLSeconds int `json:"signedUrlSeconds"`
	ImageBytes int64 `json:"imageBytes"`
	AudioBytes int64 `json:"audioBytes"`
	VideoBytes int64 `json:"videoBytes"`
	JSONBytes int64 `json:"jsonBytes"`
	ScriptSeconds int `json:"scriptSeconds"`
	ScriptMemoryMiB int `json:"scriptMemoryMiB"`
	PointsPerYuan string `json:"pointsPerYuan,omitempty"`
}

func suggestedPolicy() executionPolicy {
	return executionPolicy{AssistantSlots: 1, GenerationSlots: 4, UserSlots: 2, TransferSlots: 1, PreviewSlots: 1, ConnectSeconds: 10, QuerySeconds: 60, FirstResponseSeconds: 120, IdleSeconds: 120, TextSeconds: 1800, ImageSeconds: 900, AudioSeconds: 600, PollSeconds: 10, QueryFailures: 3, MaxWaitSeconds: 86400, TransferSeconds: 3600, DownloadRetrySeconds: []int{30, 120, 600}, StorageRetrySeconds: []int{30, 120, 600, 1800}, SignedURLSeconds: 7200, ImageBytes: 50 << 20, AudioBytes: 200 << 20, VideoBytes: 1 << 30, JSONBytes: 8 << 20, ScriptSeconds: 5, ScriptMemoryMiB: 64}
}

func encode(value any) JSON { data, _ := json.Marshal(value); return data }
func seconds(value int) time.Duration { return time.Duration(value) * time.Second }

func (a *App) executionPolicy() (executionPolicy, error) {
	var record RuntimeSettings
	var policy executionPolicy
	if err := a.db.First(&record, 1).Error; err != nil { return policy, problem(503, "execution_not_configured", "请管理员在设置中确认并保存运行参数后启用执行；本次未提交供应商") }
	if json.Unmarshal(record.Policy, &policy) != nil { return policy, problem(503, "invalid_execution_policy", "运行参数无法读取，已停止接收新任务") }
	return policy, nil
}

func (a *App) requireExecution() (executionPolicy, error) {
	policy, err := a.executionPolicy()
	if err == nil && !policy.Enabled { err = problem(503, "execution_disabled", "管理员尚未启用执行；本次未提交供应商") }
	return policy, err
}

func (a *App) getRuntimeSettings(c *gin.Context) {
	value, err := a.GetRuntimeSettings(); if err != nil { respondError(c, err); return }; c.JSON(200, value)
}

func (a *App) GetRuntimeSettings() (gin.H, error) {
	var record RuntimeSettings
	err := a.db.First(&record, 1).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) { return nil, err }
	if len(record.Policy) > 0 {
		var policy executionPolicy
		if err := json.Unmarshal(record.Policy, &policy); err != nil { return nil, err }
		policy.PointsPerYuan = ""
		record.Policy = encode(policy)
	}
	return gin.H{"record": record, "suggested": suggestedPolicy()}, nil
}

func (a *App) saveRuntimeSettings(c *gin.Context) {
	var input struct { Version uint64 `json:"version"`; Policy executionPolicy `json:"policy"` }
	if !bind(c, &input) { return }
	record, err := a.SaveRuntimeSettings(currentUser(c).ID, input.Version, input.Policy); if err != nil { respondError(c, err); return }; c.JSON(200, record)
}

func (a *App) SaveRuntimeSettings(userID string, version uint64, p executionPolicy) (RuntimeSettings, error) {
	for _, value := range []int{p.AssistantSlots, p.GenerationSlots, p.UserSlots, p.TransferSlots, p.PreviewSlots, p.ConnectSeconds, p.QuerySeconds, p.FirstResponseSeconds, p.IdleSeconds, p.TextSeconds, p.ImageSeconds, p.AudioSeconds, p.PollSeconds, p.QueryFailures, p.MaxWaitSeconds, p.TransferSeconds, p.SignedURLSeconds, p.ScriptSeconds, p.ScriptMemoryMiB} {
		if value <= 0 { return RuntimeSettings{}, problem(400, "invalid_policy", "并发、时限、间隔与资源限制必须为正整数") }
	}
	if p.ImageBytes <= 0 || p.AudioBytes <= 0 || p.VideoBytes <= 0 || p.JSONBytes <= 0 || len(p.StorageRetrySeconds) == 0 { return RuntimeSettings{}, problem(400, "invalid_policy", "文件大小限制和后台重试间隔不能为空") }
	for _, value := range append(append([]int{}, p.DownloadRetrySeconds...), p.StorageRetrySeconds...) { if value <= 0 { return RuntimeSettings{}, problem(400, "invalid_policy", "重试间隔必须为正整数") } }
	for _, value := range append([]int{p.ConnectSeconds, p.QuerySeconds, p.FirstResponseSeconds, p.IdleSeconds, p.TextSeconds, p.ImageSeconds, p.AudioSeconds, p.PollSeconds, p.MaxWaitSeconds, p.TransferSeconds, p.SignedURLSeconds, p.ScriptSeconds}, append(append([]int{}, p.DownloadRetrySeconds...), p.StorageRetrySeconds...)...) { if uint64(value) > uint64(math.MaxInt64/int64(time.Second)) { return RuntimeSettings{}, problem(400, "invalid_policy", "时限超过系统可表示范围") } }
	if p.ImageBytes == math.MaxInt64 || p.AudioBytes == math.MaxInt64 || p.VideoBytes == math.MaxInt64 || uint64(p.ScriptMemoryMiB) > uint64(math.MaxInt>>20) { return RuntimeSettings{}, problem(400, "invalid_policy", "资源限制超过系统可表示范围") }
	if p.ScriptMemoryMiB > 4096 || p.JSONBytes == math.MaxInt64 { return RuntimeSettings{}, problem(400, "invalid_policy", "WASM 线性内存最多 4096 MiB，JSON 边界不能溢出") }
	p.PointsPerYuan = ""
	record := RuntimeSettings{ID: 1, Version: version + 1, Policy: encode(p), UpdatedBy: userID}
	err := a.db.Transaction(func(tx *gorm.DB) error {
		var previous RuntimeSettings
		err := tx.First(&previous, 1).Error
		if errors.Is(err, gorm.ErrRecordNotFound) { if version != 0 { return problem(409, "version_conflict", "运行参数已变更，请重新读取") }; return tx.Create(&record).Error }
		if err != nil { return err }
		if previous.Version != version { return problem(409, "version_conflict", "运行参数已更新，当前编辑未覆盖") }
		return tx.Model(&previous).Updates(map[string]any{"policy": record.Policy, "version": record.Version, "updated_by": record.UpdatedBy}).Error
	})
	if err != nil { return record, err }
	a.wakeFiles(); a.signalWork(); a.notifyCatalog()
	return record, nil
}

func (a *App) decryptSecret(value string) (string, error) {
	data, err := base64.StdEncoding.DecodeString(value)
	if err != nil || len(data) < a.credentials.NonceSize() { return "", problem(503, "credential_unavailable", "渠道或存储凭据无法解密") }
	plain, err := a.credentials.Open(nil, data[:a.credentials.NonceSize()], data[a.credentials.NonceSize():], nil)
	if err != nil { return "", problem(503, "credential_unavailable", "渠道或存储凭据无法解密") }
	return string(plain), nil
}

func (p executionPolicy) mediaLimit(kind string) int64 {
	switch kind { case "image": return p.ImageBytes; case "audio": return p.AudioBytes; case "video": return p.VideoBytes }
	return 0
}
