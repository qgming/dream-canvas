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
			if key == "parameterDefaults" {
				models, ok := item.(map[string]any); if !ok { return invalid }
				for id, raw := range models { parameters, ok := raw.(map[string]any); if id == "" || !ok { return invalid }; for key, item := range parameters { if strings.TrimSpace(key) == "" { return invalid }; switch item.(type) { case nil, string, float64, bool: default: return invalid } } }
				continue
			}
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
			if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || key == "url" && parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil { return invalid }
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
	value, err := a.GetPreference(currentUser(c).ID, c.Param("name")); if err != nil { respondError(c, err); return }; c.JSON(200, value)
}

func (a *App) GetPreference(userID, name string) (any, error) {
	if !validPreference(name) { return nil, problem(404, "not_found", "配置不存在") }
	var preference UserPreference
	err := a.db.First(&preference, "user_id = ? AND name = ?", userID, name).Error
	if errors.Is(err, gorm.ErrRecordNotFound) { return gin.H{"version": 0, "value": nil}, nil }
	return preference, err
}

func (a *App) savePreference(c *gin.Context) {
	var input struct { Version uint64 `json:"version"`; Value JSON `json:"value"` }
	if !bind(c, &input) { return }
	value, err := a.SavePreference(currentUser(c).ID, c.Param("name"), input.Version, input.Value); if err != nil { respondError(c, err); return }; c.JSON(200, value)
}

func (a *App) SavePreference(userID, name string, version uint64, data JSON) (UserPreference, error) {
	if !validPreference(name) { return UserPreference{}, problem(404, "not_found", "配置不存在") }
	var value map[string]any
	if json.Unmarshal(data, &value) != nil || value == nil { return UserPreference{}, problem(400, "invalid_preference", "配置必须是对象") }
	if err := validatePreference(name, value); err != nil { return UserPreference{}, err }
	if name == "generation" { if err := a.validateModelDefaults(value["parameterDefaults"]); err != nil { return UserPreference{}, err } }
	preference := UserPreference{UserID: userID, Name: name}
	err := a.db.Transaction(func(tx *gorm.DB) error {
		err := tx.First(&preference, "user_id = ? AND name = ?", preference.UserID, name).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			if version != 0 { return problem(409, "version_conflict", "偏好已更新，请重新读取") }
			preference.Value, preference.Version = data, 1
			return tx.Create(&preference).Error
		}
		if err != nil { return err }
		if preference.Version != version { return problem(409, "version_conflict", "偏好已在其他页面更新，当前编辑未覆盖服务端") }
		if err := tx.Model(&preference).Updates(map[string]any{"value": data, "version": version + 1}).Error; err != nil { return err }
		return tx.First(&preference, "user_id = ? AND name = ?", preference.UserID, name).Error
	})
	if err == nil { a.notify(userID); a.signalWork() }; return preference, err
}

func (a *App) validateModelDefaults(raw any) error {
	for modelID, raw := range object(raw) {
		var model ChannelModel; if err := a.db.First(&model, "id = ?", modelID).Error; err != nil { return err }; if !model.Enabled { continue }; if err := hydrateModel(a.db, &model); err != nil { return err }
		var controls []parameterControl; if json.Unmarshal(model.Parameters, &controls) != nil { return problem(409, "invalid_parameters", "模型参数定义无法读取") }
		for key, value := range object(raw) {
			found := false
			for _, control := range controls { if control.Key != key { continue }; if control.Type == "asset" || control.Type == "reference" { return problem(400, "invalid_preference", "默认参数不保存素材，请在创作时选择") }; found = true; if value != nil { if err := validateParameterValue(control, value); err != nil { return err } }; break }
			if !found { return problem(400, "undeclared_parameter", "模型未声明默认参数「"+key+"」，请重新读取模型配置") }
		}
	}
	return nil
}

func (a *App) savedModelParameters(userID string, model ChannelModel) (map[string]any, error) {
	return savedModelParameters(a.db, userID, model, nil)
}

func savedModelParameters(db *gorm.DB, userID string, model ChannelModel, overrides map[string]any) (map[string]any, error) {
	var preference UserPreference
	err := db.First(&preference, "user_id = ? AND name = ?", userID, "generation").Error
	if errors.Is(err, gorm.ErrRecordNotFound) { return resolveParameters(model.Parameters, overrides) }; if err != nil { return nil, err }
	var value struct { Defaults map[string]map[string]any `json:"parameterDefaults"` }
	if json.Unmarshal(preference.Value, &value) != nil { return nil, problem(409, "invalid_preference", "创作偏好无法读取，未提交模型") }
	parameters := map[string]any{}
	var controls []parameterControl; if json.Unmarshal(model.Parameters, &controls) != nil { return nil, problem(409, "invalid_parameters", "模型参数定义无法读取") }
	for _, control := range controls { if control.Type != "asset" && control.Type != "reference" { if selected, ok := value.Defaults[model.ID][control.Key]; ok { parameters[control.Key] = selected } } }
	for key, value := range overrides { parameters[key] = value }
	return resolveParameters(model.Parameters, parameters)
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
	record, err := a.SaveWorkbenchRecord(currentUser(c).ID, c.Param("kind"), c.Param("id"), input.Version, input.Value)
	if err != nil { respondError(c, err); return }; c.JSON(200, record)
}

func (a *App) SaveWorkbenchRecord(userID, kind, id string, version uint64, data JSON) (WorkbenchRecord, error) {
	if !includes([]string{"image", "video"}, kind) || strings.TrimSpace(id) == "" { return WorkbenchRecord{}, problem(400, "invalid_workbench", "工作台类型或记录编号不正确") }
	var value map[string]any
	if json.Unmarshal(data, &value) != nil || value == nil || value["id"] != id { return WorkbenchRecord{}, problem(400, "invalid_record", "记录内容不正确") }
	// These are workbench presentation records; execution and billing are never inferred from them.
	record := WorkbenchRecord{UserID: userID, Kind: kind, ID: id}
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
			if version != 0 { return problem(409, "version_conflict", "记录已变更，请重新读取") }
			record.Value, record.Version = data, 1
			return tx.Create(&record).Error
		}
		if record.Version != version { return problem(409, "version_conflict", "工作台记录已在其他页面更新") }
		if err := tx.Model(&record).Updates(map[string]any{"value": data, "version": record.Version + 1}).Error; err != nil { return err }
		return tx.First(&record, "user_id = ? AND kind = ? AND id = ?", record.UserID, record.Kind, record.ID).Error
	})
	return record, err
}

func (a *App) deleteWorkbenchRecord(c *gin.Context) {
	if !workbenchKind(c) { return }
	if err := a.db.Delete(&WorkbenchRecord{}, "user_id = ? AND kind = ? AND id = ?", currentUser(c).ID, c.Param("kind"), c.Param("id")).Error; err != nil { respondError(c, err); return }
	c.Status(204)
}
