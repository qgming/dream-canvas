package app

import (
	"encoding/json"
	"strconv"
	"time"
)

// JSON keeps structured canvas data in SQLite without encoding media into it.
type JSON = json.RawMessage

type User struct {
	ID string `json:"id" gorm:"primaryKey"`
	Username string `json:"username" gorm:"uniqueIndex;not null"`
	Password string `json:"-"`
	Role string `json:"role"`
	Disabled bool `json:"disabled"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type Session struct {
	Hash string `gorm:"primaryKey"`
	UserID string `gorm:"index;not null"`
	CSRF string
	CreatedAt time.Time
}

type Project struct {
	ID string `json:"id" gorm:"primaryKey"`
	UserID string `json:"-" gorm:"index;not null"`
	Title string `json:"title"`
	Version uint64 `json:"version"`
	Document JSON `json:"document" gorm:"type:blob"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type AssetProject struct {
	ID string `json:"id" gorm:"primaryKey"`
	UserID string `json:"-" gorm:"index;not null"`
	Title string `json:"title"`
	Version uint64 `json:"version"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
	IsDefault bool `json:"isDefault" gorm:"-"`
}

type Asset struct {
	ID string `json:"id" gorm:"primaryKey"`
	UserID string `json:"-" gorm:"index;not null"`
	AssetProjectID string `json:"assetProjectId,omitempty" gorm:"index;not null;default:default"`
	Kind string `json:"kind"`
	Title string `json:"title"`
	MimeType string `json:"mimeType"`
	Bytes int64 `json:"bytes"`
	Width int `json:"width"`
	Height int `json:"height"`
	DurationMS int64 `json:"durationMs"`
	FPS string `json:"fps,omitempty"`
	VideoCodec string `json:"videoCodec,omitempty"`
	AudioCodec string `json:"audioCodec,omitempty"`
	ProbeError string `json:"probeError,omitempty"`
	PreviewState string `json:"previewState,omitempty"`
	PreviewError string `json:"previewError,omitempty"`
	WorkbenchRecordID string `json:"workbenchRecordId,omitempty" gorm:"index;not null;default:''"`
	Path string `json:"-"`
	PreviewPath string `json:"-"`
	SaveState string `json:"saveState"`
	SyncState string `json:"syncState"`
	DeleteState string `json:"deleteState"`
	RetainCloud bool `json:"retainCloud,omitempty" gorm:"not null;default:false"`
	CleanupTaskID string `json:"cleanupTaskId,omitempty" gorm:"-"`
	Error string `json:"error,omitempty"`
	StorageID string `json:"storageId,omitempty"`
	StorageName string `json:"storageName,omitempty" gorm:"-"`
	Migration *AssetMigration `json:"migration,omitempty" gorm:"-"`
	Metadata JSON `json:"metadata" gorm:"type:blob"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type AssetReference struct {
	ProjectID string `gorm:"primaryKey"`
	AssetID string `gorm:"primaryKey"`
}

func (asset Asset) MarshalJSON() ([]byte, error) {
	type plain Asset
	metadata, err := assetMetadata(asset.Metadata); if err != nil { return nil, err }
	return json.Marshal(struct { plain; Metadata map[string]json.RawMessage `json:"metadata"` }{plain(asset), metadata})
}

type Channel struct {
	ID string `json:"id" gorm:"primaryKey"`
	Name string `json:"name"`
	BaseURL string `json:"baseUrl"`
	Protocol string `json:"protocol"`
	Secret string `json:"-"`
	Enabled bool `json:"enabled"`
	Version uint64 `json:"version"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type ChannelModel struct {
	ID string `json:"id" gorm:"primaryKey"`
	ChannelID string `json:"channelId" gorm:"uniqueIndex:channel_model;not null"`
	Model string `json:"model" gorm:"uniqueIndex:channel_model;not null"`
	Name string `json:"name"`
	Capability string `json:"capability"`
	AdapterID string `json:"adapterId"`
	Enabled bool `json:"enabled"`
	Version uint64 `json:"version"`
	ParameterOverrides JSON `json:"parameterOverrides" gorm:"type:blob"`
	Parameters JSON `json:"parameters" gorm:"-"`
	Pricing JSON `json:"pricing,omitempty" gorm:"type:blob"`
	AdapterVersionID string `json:"adapterVersionId,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type ModelOrdering struct {
	ID uint `json:"-" gorm:"primaryKey"`
	Version uint64 `json:"version"`
	Orders JSON `json:"orders" gorm:"type:blob"`
}

type ScriptDraft struct {
	ID string `json:"id" gorm:"primaryKey"`
	AdapterID string `json:"adapterId" gorm:"uniqueIndex;not null"`
	Revision uint64 `json:"revision"`
	Files JSON `json:"files" gorm:"type:blob"`
	Parameters JSON `json:"parameters" gorm:"type:blob"`
	UpdatedBy string `json:"updatedBy"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type ScriptVersion struct {
	ID string `json:"id" gorm:"primaryKey"`
	AdapterID string `json:"adapterId" gorm:"index"`
	DraftRevision uint64 `json:"draftRevision"`
	Files JSON `json:"files" gorm:"type:blob"`
	Scripts JSON `json:"compiled" gorm:"type:blob"`
	Parameters JSON `json:"parameters" gorm:"type:blob"`
	Features JSON `json:"features" gorm:"type:blob"`
	PublishedBy string `json:"publishedBy"`
	CreatedAt time.Time `json:"createdAt"`
}

type ModelScript struct {
	ID string `json:"id" gorm:"primaryKey"`
	Name string `json:"name"`
	Capability string `json:"capability"`
	Description string `json:"description"`
	Builtin bool `json:"builtin"`
	AdapterVersionID string `json:"adapterVersionId"`
	Version uint64 `json:"version"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type AccessToken struct {
	ID string `json:"id" gorm:"primaryKey"`
	UserID string `json:"-" gorm:"index;not null"`
	Name string `json:"name"`
	Hash string `json:"-" gorm:"uniqueIndex;not null"`
	Scopes JSON `json:"scopes" gorm:"type:blob"`
	Projects JSON `json:"projects" gorm:"type:blob"`
	Revoked bool `json:"revoked"`
	CreatedAt time.Time `json:"createdAt"`
}

type UserPreference struct {
	UserID string `gorm:"primaryKey"`
	Name string `gorm:"primaryKey"`
	Version uint64 `json:"version"`
	Value JSON `json:"value" gorm:"type:blob"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type WorkbenchRecord struct {
	UserID string `gorm:"primaryKey"`
	Kind string `gorm:"primaryKey"`
	ID string `json:"id" gorm:"primaryKey"`
	Version uint64 `json:"version"`
	Removed bool `json:"-" gorm:"not null;default:false"`
	Value JSON `json:"value" gorm:"type:blob"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type GenerationTask struct {
	ID string `json:"id" gorm:"primaryKey"`
	UserID string `json:"-" gorm:"index;not null"`
	ProjectID string `json:"projectId,omitempty" gorm:"index"`
	WorkbenchRecordID string `json:"workbenchRecordId,omitempty" gorm:"index;not null;default:''"`
	NodeID string `json:"nodeId,omitempty"`
	ProjectVersion uint64 `json:"projectVersion"`
	ChannelID string `json:"channelId"`
	ModelID string `json:"modelId"`
	Capability string `json:"capability"`
	Snapshot JSON `json:"-" gorm:"type:blob"`
	TargetNode JSON `json:"-" gorm:"type:blob"`
	Input JSON `json:"input" gorm:"type:blob"`
	Status string `json:"status" gorm:"index"`
	UpstreamID string `json:"upstreamId,omitempty"`
	ProviderStatus string `json:"providerStatus,omitempty"`
	Progress *float64 `json:"progress,omitempty"`
	QueryStartedAt *time.Time `json:"-"`
	QueryRecoveredBy string `json:"queryRecoveredBy,omitempty"`
	QueryRecoveredAt *time.Time `json:"queryRecoveredAt,omitempty"`
	ResolvedBy string `json:"resolvedBy,omitempty"`
	ResolvedAt *time.Time `json:"resolvedAt,omitempty"`
	ResolutionNote string `json:"resolutionNote,omitempty"`
	Removed bool `json:"removed" gorm:"not null;default:false;index"`
	Text string `json:"text"`
	AssetIDs JSON `json:"assetIds" gorm:"type:blob"`
	SaveState string `json:"saveState"`
	SyncState string `json:"syncState"`
	CancelRequested bool `json:"cancelRequested"`
	Result JSON `json:"-" gorm:"type:blob"`
	RawResponseFile string `json:"-"`
	ResponseCleanupPending bool `json:"responseCleanupPending"`
	ResponseCleanupError string `json:"responseCleanupError,omitempty"`
	ResponseCleanupAttempts int `json:"-"`
	NextRunAt *time.Time `json:"nextRunAt,omitempty" gorm:"index"`
	StartedAt *time.Time `json:"startedAt,omitempty"`
	QueryFailures int `json:"queryFailures"`
	TransferAttempts int `json:"transferAttempts"`
	Applied bool `json:"applied"`
	AppliedVersion uint64 `json:"appliedVersion" gorm:"index"`
	ApplyError string `json:"applyError,omitempty"`
	UsageState string `json:"usageState"`
	DebugRevision uint64 `json:"debugRevision,omitempty"`
	CancelSent bool `json:"cancelSent"`
	CancelError string `json:"cancelError,omitempty"`
	Error string `json:"error,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type TaskAsset struct {
	TaskID string `gorm:"primaryKey"`
	AssetID string `gorm:"primaryKey"`
	Released bool `gorm:"index"`
}

type AssetVoice struct {
	AssetID string `json:"assetId" gorm:"primaryKey"`
	ChannelID string `json:"channelId" gorm:"primaryKey"`
	UserID string `json:"-" gorm:"index"`
	VoiceID string `json:"voiceId"`
	Version uint64 `json:"version"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type AssistantThread struct {
	ID string `json:"id" gorm:"primaryKey"`
	UserID string `json:"-" gorm:"index;not null"`
	Title string `json:"title"`
	Version uint64 `json:"version"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type AssistantTurn struct {
	ID string `json:"id" gorm:"primaryKey"`
	UserID string `json:"-" gorm:"index;not null"`
	ThreadID string `json:"threadId" gorm:"index;not null"`
	ProjectID string `json:"projectId,omitempty"`
	ModelID string `json:"modelId"`
	ChannelID string `json:"channelId"`
	Status string `json:"status"`
	Error string `json:"error,omitempty"`
	Snapshot JSON `json:"-" gorm:"type:blob"`
	CancelRequested bool `json:"cancelRequested"`
	Step int `json:"step"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type AssistantItem struct {
	Sequence uint64 `json:"sequence" gorm:"index"`
	ThreadID string `json:"threadId" gorm:"primaryKey"`
	TurnID string `json:"turnId" gorm:"primaryKey"`
	ID string `json:"id" gorm:"primaryKey"`
	UserID string `json:"-" gorm:"index;not null"`
	Role string `json:"role"`
	Text string `json:"text"`
	Detail JSON `json:"detail,omitempty" gorm:"type:blob"`
	CreatedAt time.Time `json:"createdAt"`
}

type AssistantSkill struct {
	UserID string `json:"-" gorm:"primaryKey"`
	Name string `json:"name" gorm:"primaryKey"`
	Description string `json:"description"`
	Instructions string `json:"instructions"`
	Interface JSON `json:"interface" gorm:"type:blob"`
	Enabled bool `json:"enabled"`
	Version uint64 `json:"version"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type RuntimeSettings struct {
	ID uint `json:"-" gorm:"primaryKey"`
	Version uint64 `json:"version"`
	SiteClosed bool `json:"-"`
	ImageWorkbenchClosed bool `json:"-" gorm:"not null;default:false"`
	VideoWorkbenchClosed bool `json:"-" gorm:"not null;default:false"`
	Policy JSON `json:"policy" gorm:"type:blob"`
	UpdatedBy string `json:"updatedBy"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type ObjectStorage struct {
	ID string `json:"id" gorm:"primaryKey"`
	Provider string `json:"provider"`
	Region string `json:"region"`
	PathStyle bool `json:"pathStyle"`
	Name string `json:"name"`
	Endpoint string `json:"endpoint"`
	Bucket string `json:"bucket"`
	AccessKeyID string `json:"-"`
	Secret string `json:"-"`
	Default bool `json:"default"`
	Version uint64 `json:"version"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type FileOperation struct {
	ID string `json:"id" gorm:"primaryKey"`
	AssetID string `json:"assetId" gorm:"uniqueIndex:file_operation"`
	Kind string `json:"kind" gorm:"uniqueIndex:file_operation"`
	SourceStorageID string `json:"-" gorm:"index"`
	TargetStorageID string `json:"-" gorm:"index"`
	Stage string `json:"stage,omitempty"`
	Attempts int `json:"attempts"`
	NextRunAt *time.Time `json:"nextRunAt,omitempty" gorm:"index"`
	Error string `json:"error,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type UsageEntry struct {
	ID string `json:"id" gorm:"primaryKey"`
	UserID string `json:"userId" gorm:"index"`
	ProjectID string `json:"projectId,omitempty" gorm:"index"`
	TaskID string `json:"taskId,omitempty"`
	TurnID string `json:"turnId,omitempty"`
	ChannelID string `json:"channelId" gorm:"index"`
	ModelID string `json:"modelId" gorm:"index"`
	Capability string `json:"capability"`
	State string `json:"state"`
	Corrected bool `json:"corrected"`
	Usage JSON `json:"usage" gorm:"type:blob"`
	Pricing JSON `json:"pricing" gorm:"type:blob"`
	CostMicros *int64 `json:"costMicros"`
	OriginalCostMicros *int64 `json:"originalCostMicros"`
	Currency string `json:"currency"`
	CostState string `json:"costState"`
	PointsMilli *int64 `json:"pointsMilli"`
	StartedAt time.Time `json:"startedAt" gorm:"index"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type UsageCorrection struct {
	ID string `json:"id" gorm:"primaryKey"`
	EntryID string `json:"entryId" gorm:"index"`
	AdminID string `json:"adminId"`
	Before JSON `json:"before" gorm:"type:blob"`
	After JSON `json:"after" gorm:"type:blob"`
	Reason string `json:"reason"`
	CreatedAt time.Time `json:"createdAt"`
}

// Integer minor units travel as strings so browser JSON parsing cannot lose precision.
func (entry UsageEntry) MarshalJSON() ([]byte, error) {
	type plain UsageEntry
	integer := func(value *int64) *string { if value == nil { return nil }; encoded := strconv.FormatInt(*value, 10); return &encoded }
	return json.Marshal(struct { plain; CostMicros *string `json:"costMicros"`; OriginalCostMicros *string `json:"originalCostMicros"`; PointsMilli *string `json:"pointsMilli"` }{plain(entry), integer(entry.CostMicros), integer(entry.OriginalCostMicros), integer(entry.PointsMilli)})
}
