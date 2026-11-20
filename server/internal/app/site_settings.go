package app

import (
	"encoding/json"
	"errors"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type siteSettings struct {
	Version uint64 `json:"version"`
	Open bool `json:"open"`
	AssistantSlots int `json:"assistantSlots"`
	GenerationSlots int `json:"generationSlots"`
	UserSlots int `json:"userSlots"`
}

type siteSettingsInput struct {
	Version uint64 `json:"version"`
	Open *bool `json:"open"`
	AssistantSlots int `json:"assistantSlots"`
	GenerationSlots int `json:"generationSlots"`
	UserSlots int `json:"userSlots"`
	Confirmed bool `json:"confirmed"`
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
	var policy executionPolicy
	if errors.Is(err, gorm.ErrRecordNotFound) { policy = suggestedPolicy() } else if json.Unmarshal(record.Policy, &policy) != nil { return siteSettings{}, problem(503, "invalid_execution_policy", "站点运行配置无法读取") }
	return siteSettings{record.Version, !record.SiteClosed, policy.AssistantSlots, policy.GenerationSlots, policy.UserSlots}, nil
}

func (a *App) SaveSiteSettings(userID string, input siteSettingsInput) (siteSettings, error) {
	var admin User
	if err := a.db.First(&admin, "id = ? AND role = ? AND disabled = ?", userID, "admin", false).Error; err != nil { return siteSettings{}, problem(403, "forbidden", "需要管理员权限") }
	if input.Open == nil || input.AssistantSlots <= 0 || input.GenerationSlots <= 0 || input.UserSlots <= 0 { return siteSettings{}, problem(400, "invalid_site_settings", "请设置站点开关及有效的并发数量") }
	if !*input.Open && !input.Confirmed { return siteSettings{}, problem(400, "confirmation_required", "请确认关闭梦想画布，普通用户将退出登录") }
	err := a.db.Transaction(func(tx *gorm.DB) error {
		var record RuntimeSettings
		err := tx.First(&record, 1).Error
		creating := errors.Is(err, gorm.ErrRecordNotFound)
		if err != nil && !creating { return err }
		if record.Version != input.Version { return problem(409, "version_conflict", "站点设置已更新，当前修改未覆盖，请重新读取") }
		var policy executionPolicy
		if creating { policy = suggestedPolicy() } else if json.Unmarshal(record.Policy, &policy) != nil { return problem(503, "invalid_execution_policy", "站点运行配置无法读取，未保存本次修改") }
		policy.AssistantSlots, policy.GenerationSlots, policy.UserSlots = input.AssistantSlots, input.GenerationSlots, input.UserSlots
		record.ID, record.Version, record.SiteClosed, record.Policy, record.UpdatedBy = 1, input.Version+1, !*input.Open, encode(policy), userID
		if creating { err = tx.Create(&record).Error } else {
			result := tx.Model(&RuntimeSettings{}).Where("id = ? AND version = ?", 1, input.Version).Updates(map[string]any{"version": record.Version, "site_closed": record.SiteClosed, "policy": record.Policy, "updated_by": userID})
			if result.Error != nil { return result.Error }
			if result.RowsAffected != 1 { return problem(409, "version_conflict", "站点设置已更新，请重新读取") }
		}
		if err != nil { return err }
		if record.SiteClosed { return tx.Where("user_id IN (?)", tx.Model(&User{}).Select("id").Where("role <> ?", "admin")).Delete(&Session{}).Error }
		return nil
	})
	if err != nil { return siteSettings{}, err }
	a.wakeFiles(); a.signalWork(); a.notifyCatalog()
	return siteSettings{input.Version+1, *input.Open, input.AssistantSlots, input.GenerationSlots, input.UserSlots}, nil
}

func (a *App) getSiteSettings(c *gin.Context) {
	value, err := a.GetSiteSettings(); if err != nil { respondError(c, err); return }; c.JSON(200, value)
}

func (a *App) saveSiteSettings(c *gin.Context) {
	var input siteSettingsInput; if !bind(c, &input) { return }
	value, err := a.SaveSiteSettings(currentUser(c).ID, input); if err != nil { respondError(c, err); return }; c.JSON(200, value)
}
