package app

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"time"

	"gorm.io/gorm"
)

// Each task and assistant turn captures the effective limits when accepted.
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
	ScriptRuntime scriptRuntimeSettings `json:"scriptRuntime"`
	ScriptSeconds int `json:"scriptSeconds,omitempty"`
	ScriptMemoryMiB int `json:"scriptMemoryMiB,omitempty"`
	PointsPerYuan string `json:"pointsPerYuan,omitempty"`
}

const (
	scriptInitSeconds = "initSeconds"
	scriptSubmitSeconds = "submitSeconds"
	scriptResultSeconds = "resultSeconds"
	scriptStreamSeconds = "streamEventSeconds"
	scriptMemoryMiB = "memoryMiB"
	scriptJSONMiB = "jsonLimitMiB"
	modelHeaderSeconds = "firstResponseSeconds"
	modelIdleSeconds = "idleSeconds"
)

type scriptRuntimeSettings map[string]int
type scriptRuntimeRange struct {
	Min int `json:"min"`
	Max int `json:"max"`
	Default int `json:"default"`
}

var scriptRuntimeRanges = map[string]scriptRuntimeRange{
	scriptInitSeconds: {1, 60, 25},
	scriptSubmitSeconds: {1, 60, 15},
	scriptResultSeconds: {1, 60, 20},
	scriptStreamSeconds: {1, 60, 10},
	scriptMemoryMiB: {32, 256, 128},
	scriptJSONMiB: {1, 32, 16},
	modelHeaderSeconds: {5, 600, 120},
	modelIdleSeconds: {5, 600, 120},
}

func defaultScriptRuntime() scriptRuntimeSettings {
	settings := scriptRuntimeSettings{}
	for field, limit := range scriptRuntimeRanges { settings[field] = limit.Default }
	return settings
}

func (p executionPolicy) scriptLimit(field string, snapshotLimit int) int {
	if value, ok := p.ScriptRuntime[field]; ok { return value }
	return snapshotLimit
}

func (p executionPolicy) scriptJSONBytes() int64 {
	if mib, ok := p.ScriptRuntime[scriptJSONMiB]; ok { return int64(mib) << 20 }
	return p.JSONBytes
}

func suggestedPolicy() executionPolicy {
	return executionPolicy{AssistantSlots: 1, GenerationSlots: 4, UserSlots: 2, TransferSlots: 1, PreviewSlots: 1, ConnectSeconds: 10, QuerySeconds: 60, FirstResponseSeconds: 120, IdleSeconds: 120, TextSeconds: 1800, ImageSeconds: 900, AudioSeconds: 600, PollSeconds: 10, QueryFailures: 3, MaxWaitSeconds: 86400, TransferSeconds: 3600, DownloadRetrySeconds: []int{30, 120, 600}, StorageRetrySeconds: []int{30, 120, 600, 1800}, SignedURLSeconds: 7200, ImageBytes: 50 << 20, AudioBytes: 200 << 20, VideoBytes: 4 << 30, JSONBytes: 8 << 20, ScriptRuntime: defaultScriptRuntime()}
}

func encode(value any) JSON { data, _ := json.Marshal(value); return data }
func seconds(value int) time.Duration { return time.Duration(value) * time.Second }

// Disarm a scoped deadline before reusing the same sandbox or response body.
func armDeadline(limit time.Duration, expire func()) func() {
	done := make(chan struct{})
	timer := time.AfterFunc(limit, func() { expire(); close(done) })
	return func() { if !timer.Stop() { <-done } }
}

func (a *App) invalidatePolicyCache() {
	a.policyMu.Lock()
	a.policyCached = false
	a.policyMu.Unlock()
}

func cloneExecutionPolicy(p executionPolicy) executionPolicy {
	if p.ScriptRuntime != nil {
		cp := make(scriptRuntimeSettings, len(p.ScriptRuntime))
		for k, v := range p.ScriptRuntime { cp[k] = v }
		p.ScriptRuntime = cp
	}
	if p.DownloadRetrySeconds != nil {
		cp := make([]int, len(p.DownloadRetrySeconds))
		copy(cp, p.DownloadRetrySeconds)
		p.DownloadRetrySeconds = cp
	}
	if p.StorageRetrySeconds != nil {
		cp := make([]int, len(p.StorageRetrySeconds))
		copy(cp, p.StorageRetrySeconds)
		p.StorageRetrySeconds = cp
	}
	return p
}

func (a *App) executionPolicy() (executionPolicy, error) {
	a.policyMu.RLock()
	if a.policyCached {
		val := cloneExecutionPolicy(a.policyVal)
		a.policyMu.RUnlock()
		return val, nil
	}
	a.policyMu.RUnlock()
	var record RuntimeSettings
	if err := a.db.First(&record, 1).Error; err != nil && !errors.Is(err, gorm.ErrRecordNotFound) { return executionPolicy{}, err }
	policy, err := record.executionPolicy()
	if err != nil { return policy, err }
	a.policyMu.Lock()
	a.policyVal = cloneExecutionPolicy(policy)
	a.policyCached = true
	a.policyMu.Unlock()
	return policy, nil
}

func (record RuntimeSettings) executionPolicy() (executionPolicy, error) {
	policy := suggestedPolicy()
	if record.ID != 0 && json.Unmarshal(record.Policy, &policy) != nil { return policy, problem(503, "invalid_execution_policy", "站点运行配置无法读取") }
	if policy.ScriptRuntime == nil { policy.ScriptRuntime = defaultScriptRuntime() }
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
