package app

import (
	"errors"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func readModelDefaults(db *gorm.DB) (ModelDefaults, error) {
	record := ModelDefaults{ID: 1}
	err := db.First(&record, "id = ?", record.ID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		record.Models = encode(map[string]string{"text": "", "image": "", "video": "", "audio": ""})
		return record, nil
	}
	return record, err
}

func (a *App) saveModelDefaults(c *gin.Context) {
	var input struct { Version uint64 `json:"version"`; Models map[string]string `json:"models"` }
	if !bind(c, &input) { return }
	record, err := a.SaveModelDefaults(input.Version, input.Models)
	if err != nil { respondError(c, err); return }
	c.JSON(200, record)
}

func (a *App) SaveModelDefaults(version uint64, models map[string]string) (ModelDefaults, error) {
	if len(models) != 4 { return ModelDefaults{}, problem(400, "invalid_model_defaults", "请分别配置文本、图片、视频和音频默认模型，未设置的能力留空") }
	for capability := range models { if !includes([]string{"text", "image", "video", "audio"}, capability) { return ModelDefaults{}, problem(400, "invalid_capability", "默认模型能力不正确") } }
	var record ModelDefaults
	err := a.db.Transaction(func(tx *gorm.DB) error {
		var err error
		record, err = readModelDefaults(tx)
		if err != nil { return err }
		if record.Version != version { return problem(409, "version_conflict", "默认模型已更新，当前编辑未覆盖服务端，请重新读取") }
		for capability, id := range models {
			if id == "" { continue }
			var model ChannelModel
			if err := tx.First(&model, "id = ? AND capability = ? AND enabled = ?", id, capability, true).Error; err != nil { if errors.Is(err, gorm.ErrRecordNotFound) { return problem(400, "invalid_default_model", "默认模型不存在、已停用或能力不匹配，请重新选择") }; return err }
			var channel Channel
			if err := tx.First(&channel, "id = ? AND enabled = ? AND secret <> ?", model.ChannelID, true, "").Error; err != nil { if errors.Is(err, gorm.ErrRecordNotFound) { return problem(400, "invalid_default_model", "默认模型的渠道不可用，请重新选择") }; return err }
			if err := hydrateModel(tx, &model); err != nil { return err }
		}
		record.Models, record.Version = encode(models), version + 1
		if version == 0 { return tx.Create(&record).Error }
		return tx.Model(&record).Updates(map[string]any{"models": record.Models, "version": record.Version}).Error
	})
	if err == nil { a.notifyCatalog() }
	return record, err
}
