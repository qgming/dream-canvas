package app

import (
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Voice IDs are provider account associations on ordinary audio assets.
func (a *App) listAssetVoices(c *gin.Context) {
	var asset Asset
	if err := a.db.First(&asset, "id = ? AND user_id = ? AND kind = ? AND delete_state = ?", c.Param("id"), currentUser(c).ID, "audio", "").Error; err != nil { respondError(c, err); return }
	rows := []AssetVoice{}
	if err := a.db.Where("asset_id = ? AND user_id = ?", asset.ID, currentUser(c).ID).Find(&rows).Error; err != nil { respondError(c, err); return }
	c.JSON(200, rows)
}

func (a *App) saveAssetVoice(c *gin.Context) {
	var input struct { VoiceID string `json:"voiceId"`; Version uint64 `json:"version"` }
	if !bind(c, &input) { return }
	row, err := a.SaveAssetVoice(currentUser(c).ID, c.Param("id"), c.Param("channelId"), input.VoiceID, input.Version)
	if err != nil { respondError(c, err); return }; c.JSON(200, row)
}

func (a *App) SaveAssetVoice(userID, assetID, channelID, voiceID string, version uint64) (AssetVoice, error) {
	row := AssetVoice{AssetID: assetID, ChannelID: channelID, UserID: userID, VoiceID: strings.TrimSpace(voiceID), Version: version+1}
	err := a.db.Transaction(func(tx *gorm.DB) error {
		var asset Asset; var channel Channel
		if err := tx.First(&asset, "id = ? AND user_id = ? AND kind = ? AND delete_state = ? AND save_state = ?", row.AssetID, row.UserID, "audio", "", "saved").Error; err != nil { return err }
		if err := tx.First(&channel, "id = ? AND enabled = ?", row.ChannelID, true).Error; err != nil { return err }
		if row.VoiceID == "" { return problem(400, "voice_required", "请输入在此渠道已经注册的音色编号") }
		var previous AssetVoice
		result := tx.Where("asset_id = ? AND channel_id = ?", row.AssetID, row.ChannelID).Limit(1).Find(&previous)
		if result.Error != nil { return result.Error }; if previous.Version != version { return problem(409, "version_conflict", "音色关联已更新，请重新读取") }
		return tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "asset_id"}, {Name: "channel_id"}}, DoUpdates: clause.AssignmentColumns([]string{"voice_id", "version", "updated_at"})}).Create(&row).Error
	})
	if err == nil { a.notify(row.UserID) }; return row, err
}
