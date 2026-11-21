package app

import (
	"errors"
	"fmt"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type siteSettings struct {
	Version uint64 `json:"version"`
	Open bool `json:"open"`
	AssistantSlots int `json:"assistantSlots"`
	GenerationSlots int `json:"generationSlots"`
	UserSlots int `json:"userSlots"`
	ScriptRuntime scriptRuntimeSettings `json:"scriptRuntime"`
	ScriptRuntimeBounds map[string]scriptRuntimeRange `json:"scriptRuntimeBounds"`
}

type siteSettingsInput struct {
	Version uint64 `json:"version"`
	Open *bool `json:"open"`
	AssistantSlots int `json:"assistantSlots"`
	GenerationSlots int `json:"generationSlots"`
	UserSlots int `json:"userSlots"`
	Confirmed bool `json:"confirmed"`
	ScriptRuntime *scriptRuntimeSettings `json:"scriptRuntime"`
}

type scriptRuntimeUpdate struct {
	Version *uint64 `json:"version"`
	ScriptRuntime scriptRuntimeSettings `json:"scriptRuntime"`
}

func validateScriptRuntime(settings scriptRuntimeSettings) error {
	if len(settings) == 0 { return problem(400, "invalid_script_runtime", "请提供要修改的接口插件运行设置") }
	for field, value := range settings {
		limit, ok := scriptRuntimeRanges[field]
		if !ok { return problem(400, "invalid_script_runtime", "包含未知的接口插件运行设置") }
		if value < limit.Min || value > limit.Max { return problem(400, "invalid_script_runtime", fmt.Sprintf("%s 必须是 %d–%d 内的整数", field, limit.Min, limit.Max)) }
	}
	return nil
}

func (a *App) siteOpen() (bool, error) {
	var record RuntimeSettings
	err := a.db.Select("id", "site_closed").First(&record, 1).Error
	if errors.Is(err, gorm.ErrRecordNotFound) { return true, nil }
	return !record.SiteClosed, err
}

func (a *App) siteAccess(user User) error {
	if user.Role == "admin" { return nil }
	open, err := a.siteOpen(); if err != nil { return err }
	if !open { return problem(503, "site_closed", "梦想画布已关闭") }
	return nil
}

func (a *App) GetSiteSettings() (siteSettings, error) {
	var record RuntimeSettings
	err := a.db.First(&record, 1).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) { return siteSettings{}, err }
	policy, err := record.executionPolicy()
	return siteSettingsView(record, policy), err
}

func siteSettingsView(record RuntimeSettings, policy executionPolicy) siteSettings {
	return siteSettings{record.Version, !record.SiteClosed, policy.AssistantSlots, policy.GenerationSlots, policy.UserSlots, policy.ScriptRuntime, scriptRuntimeRanges}
}

func (a *App) SaveSiteSettings(userID string, input siteSettingsInput) (siteSettings, error) {
	return a.updateSiteSettings(userID, input.Version, input.ScriptRuntime, &input)
}

func (a *App) SaveScriptRuntime(userID string, input scriptRuntimeUpdate) (siteSettings, error) {
	if input.Version == nil { return siteSettings{}, problem(400, "invalid_version", "请先读取站点设置版本") }
	return a.updateSiteSettings(userID, *input.Version, &input.ScriptRuntime, nil)
}

func (a *App) updateSiteSettings(userID string, version uint64, runtime *scriptRuntimeSettings, site *siteSettingsInput) (siteSettings, error) {
	var admin User
	if err := a.db.First(&admin, "id = ? AND role = ? AND disabled = ?", userID, "admin", false).Error; err != nil { return siteSettings{}, problem(403, "forbidden", "需要管理员权限") }
	if site != nil {
		if site.Open == nil || site.AssistantSlots <= 0 || site.GenerationSlots <= 0 || site.UserSlots <= 0 { return siteSettings{}, problem(400, "invalid_site_settings", "请设置站点开关及有效的并发数量") }
		if !*site.Open && !site.Confirmed { return siteSettings{}, problem(400, "confirmation_required", "请确认关闭梦想画布，普通用户将退出登录") }
	}
	if runtime != nil { if err := validateScriptRuntime(*runtime); err != nil { return siteSettings{}, err } }
	var saved siteSettings
	err := a.db.Transaction(func(tx *gorm.DB) error {
		var record RuntimeSettings
		err := tx.First(&record, 1).Error
		creating := errors.Is(err, gorm.ErrRecordNotFound)
		if err != nil && !creating { return err }
		if record.Version != version { return problem(409, "version_conflict", "站点设置已更新，当前修改未覆盖，请重新读取") }
		policy, err := record.executionPolicy(); if err != nil { return err }
		closing := false
		if site != nil {
			policy.AssistantSlots, policy.GenerationSlots, policy.UserSlots = site.AssistantSlots, site.GenerationSlots, site.UserSlots
			closing = !*site.Open && !record.SiteClosed
			record.SiteClosed = !*site.Open
		}
		if runtime != nil { for field, value := range *runtime { policy.ScriptRuntime[field] = value } }
		record.ID, record.Version, record.Policy, record.UpdatedBy = 1, version+1, encode(policy), userID
		if creating { err = tx.Create(&record).Error } else {
			result := tx.Model(&RuntimeSettings{}).Where("id = ? AND version = ?", 1, version).Updates(map[string]any{"version": record.Version, "site_closed": record.SiteClosed, "policy": record.Policy, "updated_by": userID})
			if result.Error != nil { return result.Error }
			if result.RowsAffected != 1 { return problem(409, "version_conflict", "站点设置已更新，请重新读取") }
		}
		if err != nil { return err }
		saved = siteSettingsView(record, policy)
		if closing { return tx.Where("user_id IN (?)", tx.Model(&User{}).Select("id").Where("role <> ?", "admin")).Delete(&Session{}).Error }
		return nil
	})
	if err != nil { return siteSettings{}, err }
	a.wakeFiles(); a.signalWork(); a.notifyCatalog()
	return saved, nil
}

func (a *App) getSiteSettings(c *gin.Context) {
	value, err := a.GetSiteSettings(); if err != nil { respondError(c, err); return }; c.JSON(200, value)
}

func (a *App) saveSiteSettings(c *gin.Context) {
	var input siteSettingsInput; if !bind(c, &input) { return }
	value, err := a.SaveSiteSettings(currentUser(c).ID, input); if err != nil { respondError(c, err); return }; c.JSON(200, value)
}
