package app

import (
	"encoding/json"
	"errors"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type modelOrderingView struct {
	Version uint64 `json:"version"`
	Orders map[string][]string `json:"orders"`
}

type modelOrderingData struct {
	channels []Channel
	models []ChannelModel
	tools map[string]bool
}

func loadModelOrderingData(db *gorm.DB) (modelOrderingData, error) {
	data := modelOrderingData{}
	if err := db.Order("created_at, id").Find(&data.channels).Error; err != nil { return data, err }
	if err := db.Order("created_at, id").Find(&data.models).Error; err != nil { return data, err }
	var versions []ScriptVersion
	if err := db.Select("id", "adapter_id", "features").Find(&versions).Error; err != nil { return data, err }
	data.tools = map[string]bool{}
	for _, version := range versions {
		features := map[string]any{}; _ = json.Unmarshal(version.Features, &features)
		enabled, _ := features["tools"].(bool)
		data.tools[version.AdapterID+":"+version.ID] = enabled
	}
	return data, nil
}

func orderingCandidates(data modelOrderingData) map[string][]string {
	result := map[string][]string{"channels": []string{}}
	for _, channel := range data.channels { result["channels"] = append(result["channels"], channel.ID); result["channel:"+channel.ID] = []string{} }
	for _, model := range data.models {
		result["channel:"+model.ChannelID] = append(result["channel:"+model.ChannelID], model.ID)
		result[model.Capability] = append(result[model.Capability], model.ID)
		if model.Capability == "text" && data.tools[model.AdapterID+":"+model.AdapterVersionID] { result["assistant"] = append(result["assistant"], model.ID) }
	}
	for _, key := range []string{"image", "video", "text", "audio", "assistant"} { if result[key] == nil { result[key] = []string{} } }
	return result
}

func normalizeModelOrdering(raw map[string][]string, data modelOrderingData) (map[string][]string, error) {
	candidates := orderingCandidates(data)
	for key := range raw {
		if _, exists := candidates[key]; !exists { return nil, problem(400, "invalid_model_ordering", "排序包含未知范围："+key) }
	}
	result := map[string][]string{}
	for key, available := range candidates {
		allowed := map[string]bool{}; for _, id := range available { allowed[id] = true }
		used := map[string]bool{}; normalized := []string{}
		for _, id := range raw[key] {
			if used[id] { return nil, problem(400, "invalid_model_ordering", "排序包含重复项") }
			if !allowed[id] { return result, problem(409, "model_ordering_stale", "渠道或模型已变化，请重新读取排序") }
			used[id] = true; normalized = append(normalized, id)
		}
		for _, id := range available { if !used[id] { normalized = append(normalized, id) } }
		result[key] = normalized
	}
	return result, nil
}

func readModelOrdering(db *gorm.DB) (modelOrderingView, modelOrderingData, error) {
	data, err := loadModelOrderingData(db)
	if err != nil { return modelOrderingView{}, data, err }
	record := ModelOrdering{ID: 1}
	err = db.First(&record, "id = ?", record.ID).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) { return modelOrderingView{}, data, err }
	raw := map[string][]string{}
	if err == nil && len(record.Orders) > 0 && json.Unmarshal(record.Orders, &raw) != nil { return modelOrderingView{}, data, problem(409, "invalid_model_ordering", "模型排序记录无法读取") }
	candidates := orderingCandidates(data)
	normalized := map[string][]string{}
	for key, available := range candidates {
		allowed := map[string]bool{}; for _, id := range available { allowed[id] = true }
		used := map[string]bool{}; order := []string{}
		for _, id := range raw[key] { if allowed[id] && !used[id] { order = append(order, id); used[id] = true } }
		for _, id := range available { if !used[id] { order = append(order, id) } }
		normalized[key] = order
	}
	return modelOrderingView{Version: record.Version, Orders: normalized}, data, nil
}

func (a *App) getModelOrdering(c *gin.Context) {
	value, err := a.GetModelOrdering(); if err != nil { respondError(c, err); return }; c.JSON(200, value)
}

func (a *App) GetModelOrdering() (modelOrderingView, error) {
	value, _, err := readModelOrdering(a.db); return value, err
}

func (a *App) saveModelOrdering(c *gin.Context) {
	var input struct { Version uint64 `json:"version"`; Orders map[string][]string `json:"orders"` }
	if !bind(c, &input) { return }
	value, err := a.SaveModelOrdering(input.Version, input.Orders); if err != nil { respondError(c, err); return }; c.JSON(200, value)
}

func (a *App) SaveModelOrdering(version uint64, orders map[string][]string) (modelOrderingView, error) {
	var result modelOrderingView
	err := a.db.Transaction(func(tx *gorm.DB) error {
		record, data, err := readModelOrdering(tx); if err != nil { return err }
		if record.Version != version { return problem(409, "version_conflict", "模型排序已更新，请重新读取并保留当前排列") }
		merged := map[string][]string{}
		for key, ids := range record.Orders { merged[key] = ids }
		for key, ids := range orders { merged[key] = ids }
		normalized, err := normalizeModelOrdering(merged, data); if err != nil { return err }
		stored := ModelOrdering{ID: 1, Version: version + 1, Orders: encode(normalized)}
		if version == 0 {
			var count int64; if err := tx.Model(&ModelOrdering{}).Where("id = ?", 1).Count(&count).Error; err != nil { return err }
			if count > 0 { return problem(409, "version_conflict", "模型排序已更新，请重新读取并保留当前排列") }
			if err := tx.Create(&stored).Error; err != nil { return err }
		} else {
			result := tx.Model(&ModelOrdering{}).Where("id = ? AND version = ?", 1, version).Updates(map[string]any{"orders": stored.Orders, "version": stored.Version})
			if result.Error != nil { return result.Error }
			if result.RowsAffected != 1 { return problem(409, "version_conflict", "模型排序已更新，请重新读取并保留当前排列") }
		}
		result = modelOrderingView{Version: stored.Version, Orders: normalized}
		return nil
	})
	if err == nil { a.notifyCatalog() }
	return result, err
}
