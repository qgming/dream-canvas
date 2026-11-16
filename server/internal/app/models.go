package app

import (
	"encoding/json"
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

type Asset struct {
	ID string `json:"id" gorm:"primaryKey"`
	UserID string `json:"-" gorm:"index;not null"`
	Kind string `json:"kind"`
	Title string `json:"title"`
	MimeType string `json:"mimeType"`
	Bytes int64 `json:"bytes"`
	Width int `json:"width"`
	Height int `json:"height"`
	Path string `json:"-"`
	PreviewPath string `json:"-"`
	SaveState string `json:"saveState"`
	SyncState string `json:"syncState"`
	DeleteState string `json:"deleteState"`
	Error string `json:"error,omitempty"`
	StorageID string `json:"storageId,omitempty"`
	Metadata JSON `json:"metadata" gorm:"type:blob"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type AssetReference struct {
	ProjectID string `gorm:"primaryKey"`
	AssetID string `gorm:"primaryKey"`
}

type Approval struct {
	ID string `json:"id" gorm:"primaryKey"`
	UserID string `json:"-" gorm:"index;not null"`
	Action string `json:"action"`
	TargetID string `json:"targetId"`
	Version uint64 `json:"version"`
	Status string `json:"status"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type Channel struct {
	ID string `json:"id" gorm:"primaryKey"`
	Name string `json:"name"`
	BaseURL string `json:"baseUrl"`
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
	Protocol string `json:"protocol"`
	Enabled bool `json:"enabled"`
	Version uint64 `json:"version"`
	Parameters JSON `json:"parameters" gorm:"type:blob"`
	Pricing JSON `json:"pricing" gorm:"type:blob"`
	PublishedVersionID string `json:"publishedVersionId,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type InterfaceDraft struct {
	ID string `json:"id" gorm:"primaryKey"`
	ModelID string `json:"modelId" gorm:"uniqueIndex;not null"`
	Revision uint64 `json:"revision"`
	Scripts JSON `json:"scripts" gorm:"type:blob"`
	Parameters JSON `json:"parameters" gorm:"type:blob"`
	UpdatedBy string `json:"updatedBy"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type InterfaceVersion struct {
	ID string `json:"id" gorm:"primaryKey"`
	ModelID string `json:"modelId" gorm:"index;not null"`
	DraftRevision uint64 `json:"draftRevision"`
	Scripts JSON `json:"scripts" gorm:"type:blob"`
	Parameters JSON `json:"parameters" gorm:"type:blob"`
	Verified bool `json:"verified"`
	PublishedBy string `json:"publishedBy"`
	CreatedAt time.Time `json:"createdAt"`
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
	Value JSON `json:"value" gorm:"type:blob"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type GenerationTask struct {
	ID string `json:"id" gorm:"primaryKey"`
	UserID string `json:"-" gorm:"index;not null"`
	ProjectID string `json:"projectId,omitempty" gorm:"index"`
	NodeID string `json:"nodeId,omitempty"`
	ProjectVersion uint64 `json:"projectVersion"`
	ChannelID string `json:"channelId"`
	ModelID string `json:"modelId"`
	Capability string `json:"capability"`
	Snapshot JSON `json:"-" gorm:"type:blob"`
	Input JSON `json:"input" gorm:"type:blob"`
	Status string `json:"status" gorm:"index"`
	UpstreamID string `json:"upstreamId,omitempty"`
	Text string `json:"text"`
	AssetIDs JSON `json:"assetIds" gorm:"type:blob"`
	SaveState string `json:"saveState"`
	SyncState string `json:"syncState"`
	CancelRequested bool `json:"cancelRequested"`
	Error string `json:"error,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type TaskAsset struct {
	TaskID string `gorm:"primaryKey"`
	AssetID string `gorm:"primaryKey"`
	Released bool `gorm:"index"`
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
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type AssistantItem struct {
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
