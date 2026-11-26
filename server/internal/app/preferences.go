package app

import (
	"encoding/json"
	"errors"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func validPreference(name string) bool { return name == "generation" }

func validatePreference(name string, value map[string]any) error {
	invalid := problem(400, "invalid_preference", "配置字段或类型不正确")
	if name == "generation" {
		for key, item := range value {
			if key == "autoFocusOnSelect" { if _, ok := item.(bool); !ok { return invalid }; continue }
			if key != "nodeRegenerateBehavior" { return invalid }
			text, ok := item.(string)
			if !ok { return invalid }
			if key == "nodeRegenerateBehavior" && text != "new-node" && text != "overwrite" { return invalid }
		}
		return nil
	}
	return invalid
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

func (a *App) requireWorkbenchOpen(kind string) error {
	availability, err := a.getSiteAvailability()
	if err != nil { return err }
	if kind == "image" && !availability.ImageWorkbenchOpen {
		return problem(403, "workbench_closed", "生图工作台已关闭")
	}
	if kind == "video" && !availability.VideoWorkbenchOpen {
		return problem(403, "workbench_closed", "视频创作台已关闭")
	}
	return nil
}

func workbenchKind(c *gin.Context) bool {
	if c.Param("kind") == "image" || c.Param("kind") == "video" { return true }
	respondError(c, problem(400, "invalid_workbench", "工作台类型不正确"))
	return false
}

func (a *App) listWorkbenchRecords(c *gin.Context) {
	if !workbenchKind(c) { return }
	if err := a.requireWorkbenchOpen(c.Param("kind")); err != nil { respondError(c, err); return }
	records := []WorkbenchRecord{}
	if err := a.db.Where("user_id = ? AND kind = ? AND removed = ?", currentUser(c).ID, c.Param("kind"), false).Order("created_at DESC").Find(&records).Error; err != nil { respondError(c, err); return }
	c.JSON(200, records)
}

func (a *App) saveWorkbenchRecord(c *gin.Context) {
	if !workbenchKind(c) { return }
	if err := a.requireWorkbenchOpen(c.Param("kind")); err != nil { respondError(c, err); return }
	if strings.TrimSpace(c.Param("id")) == "" { respondError(c, problem(400, "invalid_id", "记录编号不能为空")); return }
	var input struct { Version uint64 `json:"version"`; Value JSON `json:"value"` }
	if !bind(c, &input) { return }
	record, err := a.SaveWorkbenchRecord(currentUser(c).ID, c.Param("kind"), c.Param("id"), input.Version, input.Value)
	if err != nil { respondError(c, err); return }; c.JSON(200, record)
}

func (a *App) SaveWorkbenchRecord(userID, kind, id string, version uint64, data JSON) (WorkbenchRecord, error) {
	if !includes([]string{"image", "video"}, kind) || strings.TrimSpace(id) == "" { return WorkbenchRecord{}, problem(400, "invalid_workbench", "工作台类型或记录编号不正确") }
	if err := a.requireWorkbenchOpen(kind); err != nil { return WorkbenchRecord{}, err }
	var value map[string]any
	if json.Unmarshal(data, &value) != nil || value == nil || value["id"] != id { return WorkbenchRecord{}, problem(400, "invalid_record", "记录内容不正确") }
	// These are workbench presentation records; execution and billing are never inferred from them.
	record := WorkbenchRecord{UserID: userID, Kind: kind, ID: id}
	err := a.db.Transaction(func(tx *gorm.DB) error {
		err := tx.First(&record, "user_id = ? AND kind = ? AND id = ?", record.UserID, record.Kind, record.ID).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) { return err }
		missing := errors.Is(err, gorm.ErrRecordNotFound)
		if record.Removed { return problem(409, "record_removed", "生成记录已删除，不能重新保存") }
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
	if err := a.requireWorkbenchOpen(c.Param("kind")); err != nil { respondError(c, err); return }
	var input struct { Version uint64 `json:"version"` }
	if !bind(c, &input) { return }
	pending, err := a.DeleteWorkbenchRecord(currentUser(c).ID, c.Param("kind"), c.Param("id"), input.Version)
	if err != nil { respondError(c, err); return }
	c.JSON(200, gin.H{"removed": true, "cleanupPending": pending})
}

func (a *App) DeleteWorkbenchRecord(userID, kind, id string, version uint64) (bool, error) {
	if !includes([]string{"image", "video"}, kind) || strings.TrimSpace(id) == "" { return false, problem(400, "invalid_workbench", "工作台类型或记录编号不正确") }
	if err := a.requireWorkbenchOpen(kind); err != nil { return false, err }
	pending := false
	err := a.db.Transaction(func(tx *gorm.DB) error {
		var record WorkbenchRecord
		if err := tx.First(&record, "user_id = ? AND kind = ? AND id = ?", userID, kind, id).Error; err != nil { return err }
		if record.Removed {
			var count int64
			if err := tx.Model(&Asset{}).Where("user_id = ? AND workbench_record_id = ? AND delete_state = ?", userID, id, "pending").Count(&count).Error; err != nil { return err }; pending = count > 0
		} else if record.Version != version { return problem(409, "version_conflict", "生成记录已更新，请重新读取后删除") }
		var value any
		if json.Unmarshal(record.Value, &value) != nil { return problem(409, "invalid_record", "生成记录损坏，不能确认要清理的文件") }
		refs, err := collectAssetReferences(value); if err != nil { return err }
		var owned []string
		if err := tx.Model(&Asset{}).Where("user_id = ? AND workbench_record_id = ?", userID, id).Pluck("id", &owned).Error; err != nil { return err }
		if err := tx.Model(&record).Updates(map[string]any{"removed": true, "value": JSON(`{}`), "version": record.Version+1}).Error; err != nil { return err }
		queued, err := queueWorkbenchMediaCleanup(tx, userID, append(refs, owned...)); if err != nil { return err }; pending = pending || queued
		var active int64
		if err := tx.Model(&GenerationTask{}).Where("user_id = ? AND workbench_record_id = ? AND status NOT IN ?", userID, id, []string{"succeeded", "failed", "cancelled", "interrupted"}).Count(&active).Error; err != nil { return err }
		pending = pending || active > 0; return nil
	})
	if err == nil { a.notify(userID); a.signalWork() }; return pending, err
}

// Only record-owned media is eligible; a manual library save clears its ownership.
// Shared project/record references protect the same original from local deletion.
func queueWorkbenchMediaCleanup(tx *gorm.DB, userID string, ids []string) (bool, error) {
	if len(ids) == 0 { return false, nil }
	var assets []Asset
	if err := tx.Where("id IN ? AND user_id = ? AND workbench_record_id <> ? AND delete_state = ?", ids, userID, "", "").Find(&assets).Error; err != nil { return false, err }
	if len(assets) == 0 { return false, nil }
	protected := map[string]bool{}
	activeRecords := map[string]bool{}
	var records []WorkbenchRecord
	if err := tx.Where("user_id = ? AND removed = ?", userID, false).Find(&records).Error; err != nil { return false, err }
	for _, record := range records {
		activeRecords[record.ID] = true
		var value any
		if json.Unmarshal(record.Value, &value) != nil { return false, problem(409, "invalid_record", "其他生成记录损坏，暂时无法安全清理共享文件") }
		refs, err := collectAssetReferences(value); if err != nil { return false, err }
		for _, id := range refs { protected[id] = true }
	}
	pending := false
	for _, asset := range assets {
		if protected[asset.ID] || activeRecords[asset.WorkbenchRecordID] { continue }
		var count int64
		if err := tx.Model(&AssetReference{}).Where("asset_id = ?", asset.ID).Count(&count).Error; err != nil { return false, err }
		if count > 0 { continue }
		if err := tx.Model(&asset).Updates(map[string]any{"delete_state": "pending", "error": ""}).Error; err != nil { return false, err }
		if err := queueAssetCleanup(tx, asset.ID); err != nil { return false, err }
		pending = true
	}
	return pending, nil
}
