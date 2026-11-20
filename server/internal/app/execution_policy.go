package app

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"time"

	"gorm.io/gorm"
)

// Internal execution bounds remain server defaults; only concurrency is exposed.
type executionPolicy struct {
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
	if err := a.db.First(&record, 1).Error; errors.Is(err, gorm.ErrRecordNotFound) { return suggestedPolicy(), nil } else if err != nil { return policy, err }
	if json.Unmarshal(record.Policy, &policy) != nil { return policy, problem(503, "invalid_execution_policy", "运行参数无法读取，已停止接收新任务") }
	return policy, nil
}

func (a *App) requireExecution() (executionPolicy, error) {
	return a.executionPolicy()
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
