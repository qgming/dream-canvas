package app

import (
	"encoding/json"
	"errors"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func validPreference(name string) bool { return name == "generation" || name == "prompt-sources" }

func validatePreference(name string, value map[string]any) error {
	invalid := problem(400, "invalid_preference", "配置字段或类型不正确")
	if name == "generation" {
		for key, item := range value {
			if key == "autoFocusOnSelect" { if _, ok := item.(bool); !ok { return invalid }; continue }
			if !includes([]string{"model", "imageModel", "textModel", "videoModel", "audioModel", "audioVoice", "audioFormat", "audioSpeed", "audioInstructions", "videoSeconds", "vquality", "videoGenerateAudio", "videoWatermark", "videoMode", "systemPrompt", "reasoningEffort", "quality", "size", "background", "count", "canvasImageCount", "nodeRegenerateBehavior"}, key) { return invalid }
			text, ok := item.(string)
			if !ok { return invalid }
			if key == "reasoningEffort" && !includes([]string{"auto", "low", "medium", "high", "xhigh"}, text) { return invalid }
			if key == "nodeRegenerateBehavior" && text != "new-node" && text != "overwrite" { return invalid }
		}
		return nil
	}
	if len(value) != 2 { return invalid }
	sources, ok := value["sources"].([]any)
	if !ok { return invalid }
	ids := map[string]bool{}
	for _, item := range sources {
		source, ok := item.(map[string]any)
		if !ok || len(source) != 6 { return invalid }
		for _, key := range []string{"id", "name", "url", "homepage"} { if _, ok := source[key].(string); !ok { return invalid } }
		id := source["id"].(string)
		if strings.TrimSpace(id) == "" || ids[id] || strings.TrimSpace(source["name"].(string)) == "" { return invalid }
		ids[id] = true
		for _, key := range []string{"enabled", "builtIn"} { if _, ok := source[key].(bool); !ok { return invalid } }
		for _, key := range []string{"url", "homepage"} {
			text := source[key].(string)
			if key == "homepage" && text == "" { continue }
			parsed, err := url.Parse(text)
			if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || parsed.User != nil { return invalid }
		}
	}
	schedule, ok := value["schedule"].(map[string]any)
	if !ok || len(schedule) != 2 { return invalid }
	interval, ok := schedule["intervalMinutes"].(float64)
	// Preserve the existing source scheduler choices; no new refresh policy is introduced here.
	if !ok || (interval != 0 && interval != 30 && interval != 60 && interval != 360 && interval != 1440) { return invalid }
	last, ok := schedule["lastFetchedAt"].(string)
	if !ok { return invalid }
	if last != "" { if _, err := time.Parse(time.RFC3339Nano, last); err != nil { return invalid } }
	return nil
}

func (a *App) getPreference(c *gin.Context) {
	if !validPreference(c.Param("name")) { respondError(c, problem(404, "not_found", "配置不存在")); return }
	var preference UserPreference
	err := a.db.First(&preference, "user_id = ? AND name = ?", currentUser(c).ID, c.Param("name")).Error
	if errors.Is(err, gorm.ErrRecordNotFound) { c.JSON(200, gin.H{"version": 0, "value": nil}); return }
	if err != nil { respondError(c, err); return }
	c.JSON(200, preference)
}

func (a *App) savePreference(c *gin.Context) {
	name := c.Param("name")
	if !validPreference(name) { respondError(c, problem(404, "not_found", "配置不存在")); return }
	var input struct { Version uint64 `json:"version"`; Value JSON `json:"value"` }
	if !bind(c, &input) { return }
	var value map[string]any
	if json.Unmarshal(input.Value, &value) != nil || value == nil { respondError(c, problem(400, "invalid_preference", "配置必须是对象")); return }
	if err := validatePreference(name, value); err != nil { respondError(c, err); return }
	preference := UserPreference{UserID: currentUser(c).ID, Name: name}
	err := a.db.Transaction(func(tx *gorm.DB) error {
		err := tx.First(&preference, "user_id = ? AND name = ?", preference.UserID, name).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			if input.Version != 0 { return problem(409, "version_conflict", "偏好已更新，请重新读取") }
			preference.Value, preference.Version = input.Value, 1
			return tx.Create(&preference).Error
		}
		if err != nil { return err }
		if preference.Version != input.Version { return problem(409, "version_conflict", "偏好已在其他页面更新，当前编辑未覆盖服务端") }
		if err := tx.Model(&preference).Updates(map[string]any{"value": input.Value, "version": input.Version + 1}).Error; err != nil { return err }
		return tx.First(&preference, "user_id = ? AND name = ?", preference.UserID, name).Error
	})
	if err != nil { respondError(c, err); return }
	c.JSON(200, preference)
}

func workbenchKind(c *gin.Context) bool {
	if c.Param("kind") == "image" || c.Param("kind") == "video" { return true }
	respondError(c, problem(400, "invalid_workbench", "工作台类型不正确"))
	return false
}

func (a *App) listWorkbenchRecords(c *gin.Context) {
	if !workbenchKind(c) { return }
	records := []WorkbenchRecord{}
	if err := a.db.Where("user_id = ? AND kind = ?", currentUser(c).ID, c.Param("kind")).Order("created_at DESC").Find(&records).Error; err != nil { respondError(c, err); return }
	c.JSON(200, records)
}

func (a *App) saveWorkbenchRecord(c *gin.Context) {
	if !workbenchKind(c) { return }
	if strings.TrimSpace(c.Param("id")) == "" { respondError(c, problem(400, "invalid_id", "记录编号不能为空")); return }
	var input struct { Version uint64 `json:"version"`; Value JSON `json:"value"` }
	if !bind(c, &input) { return }
	var value map[string]any
	if json.Unmarshal(input.Value, &value) != nil || value == nil || value["id"] != c.Param("id") { respondError(c, problem(400, "invalid_record", "记录内容不正确")); return }
	// These are workbench presentation records; execution and billing are never inferred from them.
	record := WorkbenchRecord{UserID: currentUser(c).ID, Kind: c.Param("kind"), ID: c.Param("id")}
	err := a.db.Transaction(func(tx *gorm.DB) error {
		err := tx.First(&record, "user_id = ? AND kind = ? AND id = ?", record.UserID, record.Kind, record.ID).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) { return err }
		missing := errors.Is(err, gorm.ErrRecordNotFound)
		var previous any
		if !missing && json.Unmarshal(record.Value, &previous) != nil { return problem(409, "invalid_record", "原工作台记录损坏，不能覆盖") }
		oldRefs, err := collectAssetReferences(previous)
		if err != nil { return err }
		refs, err := collectAssetReferences(value)
		if err != nil { return err }
		if err := checkAssets(tx, record.UserID, refs); err != nil { return err }
		for _, id := range refs {
			var asset Asset
			if err := tx.First(&asset, "id = ?", id).Error; err != nil { return err }
			if asset.DeleteState != "" && !includes(oldRefs, id) { return problem(409, "asset_deleted", "资产已删除，不能新增工作台引用") }
		}
		if missing {
			if input.Version != 0 { return problem(409, "version_conflict", "记录已变更，请重新读取") }
			record.Value, record.Version = input.Value, 1
			return tx.Create(&record).Error
		}
		if record.Version != input.Version { return problem(409, "version_conflict", "工作台记录已在其他页面更新") }
		if err := tx.Model(&record).Updates(map[string]any{"value": input.Value, "version": record.Version + 1}).Error; err != nil { return err }
		return tx.First(&record, "user_id = ? AND kind = ? AND id = ?", record.UserID, record.Kind, record.ID).Error
	})
	if err != nil { respondError(c, err); return }
	c.JSON(200, record)
}

func (a *App) deleteWorkbenchRecord(c *gin.Context) {
	if !workbenchKind(c) { return }
	if err := a.db.Delete(&WorkbenchRecord{}, "user_id = ? AND kind = ? AND id = ?", currentUser(c).ID, c.Param("kind"), c.Param("id")).Error; err != nil { respondError(c, err); return }
	c.Status(204)
}
