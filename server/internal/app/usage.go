package app

import (
	"bytes"
	"encoding/json"
	"math"
	"math/big"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func normalizeUsage(usage map[string]any) map[string]any {
	if usage == nil { return map[string]any{} }
	if value, ok := usage["prompt_tokens"]; ok { usage["input_tokens"] = value }
	if value, ok := usage["completion_tokens"]; ok { usage["output_tokens"] = value }
	if cached, ok := object(usage["prompt_tokens_details"])["cached_tokens"]; ok { usage["cached_tokens"] = cached }
	if cached, ok := object(usage["input_tokens_details"])["cached_tokens"]; ok { usage["cached_tokens"] = cached }
	if input, ok := decimalValue(text(usage["input_tokens"])); ok { if cached, ok := decimalValue(text(usage["cached_tokens"])); ok && input.Cmp(cached) >= 0 { usage["uncached_input_tokens"] = new(big.Rat).Sub(input, cached).FloatString(0) } }
	return usage
}

func normalizedUsageState(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "actual", "estimated", "unknown":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return "unknown"
	}
}

func usageParameters(a *App, task GenerationTask, turnID string) map[string]any {
	if turnID != "" {
		var turn AssistantTurn
		if a.db.First(&turn, "id = ?", turnID).Error == nil {
			var snapshot assistantSnapshot
			if json.Unmarshal(turn.Snapshot, &snapshot) == nil { return snapshot.Parameters }
		}
	}
	if len(task.Input) > 0 {
		var input generationInput
		if json.Unmarshal(task.Input, &input) == nil {
			var parameters map[string]any
			if json.Unmarshal(input.Parameters, &parameters) == nil { return parameters }
		}
	}
	return map[string]any{}
}

func (a *App) usageEntry(id string, task GenerationTask, turnID string, startedAt time.Time, usage map[string]any, snapshot executionSnapshot, state string) UsageEntry {
	if startedAt.IsZero() { startedAt = time.Now() }
	usage = normalizeUsage(usage)
	if len(usage) == 0 { state = "unknown" }
	state = normalizedUsageState(state)
	pricing, _ := parseModelPricing(snapshot.Model.Pricing)
	parameters := usageParameters(a, task, turnID)
	cost, points, original := usageCost(usage, pricing, snapshot.Policy.PointsPerYuan, parameters)
	priceSnapshot := pricingSnapshot(pricing, snapshot.Policy.PointsPerYuan)
	costState := "estimated"; if cost == nil { costState = "unknown" }
	return UsageEntry{ID: id, UserID: task.UserID, ProjectID: task.ProjectID, TaskID: task.ID, TurnID: turnID, ChannelID: snapshot.ChannelID, ModelID: snapshot.Model.ID, Capability: snapshot.Model.Capability, State: state, Usage: encode(usage), Pricing: priceSnapshot, CostMicros: cost, OriginalCostMicros: original, Currency: pricing.Currency, CostState: costState, PointsMilli: points, StartedAt: startedAt}
}

func upsertUsage(db *gorm.DB, entry UsageEntry) error {
	return db.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "id"}}, DoUpdates: clause.AssignmentColumns([]string{"state", "usage", "pricing", "cost_micros", "original_cost_micros", "currency", "cost_state", "points_milli", "updated_at"}), Where: clause.Where{Exprs: []clause.Expression{clause.Eq{Column: "corrected", Value: false}}}}).Create(&entry).Error
}

func (a *App) recordUsage(id string, task GenerationTask, turnID string, startedAt time.Time, usage map[string]any, snapshot executionSnapshot, state string) error {
	entry := a.usageEntry(id, task, turnID, startedAt, usage, snapshot, state)
	err := upsertUsage(a.db, entry)
	if err == nil { a.notify(task.UserID) }
	return err
}

func (a *App) discardUnsubmittedUsage(id, userID string) error {
	result := a.db.Where("id = ? AND user_id = ? AND corrected = ? AND state = ?", id, userID, false, "unknown").Delete(&UsageEntry{})
	if result.Error == nil && result.RowsAffected > 0 { a.notify(userID) }
	return result.Error
}

func (a *App) listUsage(c *gin.Context) {
	filters := map[string]string{}; for _, key := range []string{"userId", "projectId", "channelId", "modelId", "capability", "from", "to"} { filters[key] = c.Query(key) }
	userID := currentUser(c).ID; if currentUser(c).Role == "admin" && strings.HasPrefix(c.FullPath(), "/api/admin/") { userID = "" }
	value, err := a.ListUsage(userID, nil, filters); if err != nil { respondError(c, err); return }; c.JSON(200, value)
}

type usageEntryView struct {
	ID string `json:"id"`
	UserID string `json:"userId"`
	ProjectID string `json:"projectId,omitempty"`
	TaskID string `json:"taskId,omitempty"`
	TurnID string `json:"turnId,omitempty"`
	ChannelID string `json:"channelId"`
	ModelID string `json:"modelId"`
	Capability string `json:"capability"`
	State string `json:"state"`
	Corrected bool `json:"corrected"`
	Usage map[string]any `json:"usage"`
	Pricing publicModelPricing `json:"pricing"`
	PointsMilli *string `json:"pointsMilli"`
	StartedAt time.Time `json:"startedAt"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type usageModelSummary struct {
	ChannelID string `json:"channelId"`
	ModelID string `json:"modelId"`
	Capability string `json:"capability"`
	CallCount int `json:"callCount"`
	PointsMilli string `json:"pointsMilli"`
	PendingCount int `json:"pendingCount"`
}

type usageSummary struct {
	PointsMilli string `json:"pointsMilli"`
	CallCount int `json:"callCount"`
	PendingCount int `json:"pendingCount"`
	ByModel []usageModelSummary `json:"byModel"`
}

func usageEntryViewFor(entry UsageEntry) usageEntryView {
	var usage, snapshot map[string]any
	_ = json.Unmarshal(entry.Usage, &usage); if usage == nil { usage = map[string]any{} }
	_ = json.Unmarshal(entry.Pricing, &snapshot); if snapshot == nil { snapshot = map[string]any{} }
	pricing, _ := parseModelPricing(entry.Pricing)
	var points *string; if entry.PointsMilli != nil { value := strconv.FormatInt(*entry.PointsMilli, 10); points = &value }
	return usageEntryView{ID: entry.ID, UserID: entry.UserID, ProjectID: entry.ProjectID, TaskID: entry.TaskID, TurnID: entry.TurnID, ChannelID: entry.ChannelID, ModelID: entry.ModelID, Capability: entry.Capability, State: entry.State, Corrected: entry.Corrected, Usage: publicUsageValues(usage, pricing), Pricing: projectPublicModelPricing(entry.Pricing, text(snapshot["pointsPerYuan"])), PointsMilli: points, StartedAt: entry.StartedAt, CreatedAt: entry.CreatedAt, UpdatedAt: entry.UpdatedAt}
}

func publicUsageUnits(pricing modelPricing) map[string]bool {
	units := map[string]bool{
		"input_tokens": true, "cached_tokens": true, "uncached_input_tokens": true,
		"output_tokens": true, "images": true, "seconds": true, "characters": true, "requests": true,
	}
	add := func(rates map[string]pricingRate) { for unit := range rates { if !publicUsageCostKey(unit) { units[unit] = true } } }
	add(pricing.Rates)
	for _, tier := range pricing.Tiers { add(tier.Rates) }
	return units
}

func publicUsageValues(usage map[string]any, pricing modelPricing) map[string]any {
	units := publicUsageUnits(pricing)
	result := map[string]any{}
	for unit, value := range usage {
		if !units[unit] || publicUsageCostKey(unit) { continue }
		if publicUsageQuantity(value) { result[unit] = value }
	}
	return result
}

func publicUsageQuantity(value any) bool {
	finite := func(value float64) bool { return !math.IsNaN(value) && !math.IsInf(value, 0) && value >= 0 }
	switch value := value.(type) {
	case string:
		number, err := strconv.ParseFloat(strings.TrimSpace(value), 64); return err == nil && finite(number)
	case json.Number:
		number, err := strconv.ParseFloat(string(value), 64); return err == nil && finite(number)
	case float64:
		return finite(value)
	case float32:
		return finite(float64(value))
	case int:
		return value >= 0
	case int8:
		return value >= 0
	case int16:
		return value >= 0
	case int32:
		return value >= 0
	case int64:
		return value >= 0
	case uint, uint8, uint16, uint32, uint64:
		return true
	default:
		return false
	}
}

func publicUsageCostKey(key string) bool {
	normalized := strings.ToLower(strings.NewReplacer("_", "", "-", "", " ", "", ".", "").Replace(key))
	for _, marker := range []string{"cost", "price", "pricing", "amount", "fee", "tax", "expense", "discount", "currency", "exchangerate", "pointsperyuan", "billing", "charge", "invoice"} {
		if strings.Contains(normalized, marker) { return true }
	}
	return false
}

func (a *App) ListUsage(userID string, projects []string, filters map[string]string) (gin.H, error) {
	query := a.db.Model(&UsageEntry{})
	if userID != "" { query = query.Where("user_id = ?", userID) }; if len(projects) > 0 { query = query.Where("project_id IN ?", projects) }
	for key, column := range map[string]string{"userId": "user_id", "projectId": "project_id", "channelId": "channel_id", "modelId": "model_id", "capability": "capability"} { if value := filters[key]; value != "" { query = query.Where(column+" = ?", value) } }
	entries := []UsageEntry{}
	for _, key := range []string{"from", "to"} { if value := filters[key]; value != "" { parsed, err := time.Parse(time.RFC3339Nano, value); if err != nil { return nil, problem(400, "invalid_date", "统计日期需要完整时区时间") }; operator := ">="; if key == "to" { operator = "<=" }; query = query.Where("started_at "+operator+" ?", parsed) } }
	if err := query.Order("started_at DESC, id").Find(&entries).Error; err != nil { return nil, err }
	views := make([]usageEntryView, 0, len(entries))
	summary := usageSummary{PointsMilli: "0", ByModel: []usageModelSummary{}}
	total, indexes := new(big.Int), map[string]int{}
	for _, entry := range entries {
		views = append(views, usageEntryViewFor(entry))
		key := entry.ChannelID+"\n"+entry.ModelID+"\n"+entry.Capability
		index, exists := indexes[key]
		if !exists { summary.ByModel = append(summary.ByModel, usageModelSummary{ChannelID: entry.ChannelID, ModelID: entry.ModelID, Capability: entry.Capability, PointsMilli: "0"}); index = len(summary.ByModel)-1; indexes[key] = index }
		group := &summary.ByModel[index]
		summary.CallCount++; group.CallCount++
		if entry.PointsMilli == nil { summary.PendingCount++; group.PendingCount++ } else {
			value := big.NewInt(*entry.PointsMilli); total.Add(total, value)
			amount, _ := new(big.Int).SetString(group.PointsMilli, 10); amount.Add(amount, value); group.PointsMilli = amount.String()
		}
	}
	summary.PointsMilli = total.String()
	return gin.H{"entries": views, "summary": summary}, nil
}

func (a *App) repairAssistantUsage() {
	var items []AssistantItem
	if a.db.Where("json_extract(detail, '$.usageRecordPending') = ? AND turn_id IN (?)", true, a.db.Model(&AssistantTurn{}).Select("id").Where("status IN ?", []string{"interrupted", "failed", "cancelled", "succeeded"})).Find(&items).Error != nil { return }
	for _, item := range items {
		var detail map[string]any; var turn AssistantTurn; var snapshot assistantSnapshot
		if json.Unmarshal(item.Detail, &detail) != nil || text(detail["usageId"]) == "" { continue }
		if detail["usageUnsubmitted"] == true {
			if a.discardUnsubmittedUsage(text(detail["usageId"]), item.UserID) != nil { continue }
		} else {
			if a.db.First(&turn, "id = ? AND user_id = ?", item.TurnID, item.UserID).Error != nil || json.Unmarshal(turn.Snapshot, &snapshot) != nil { continue }
			startedAt, _ := time.Parse(time.RFC3339Nano, text(detail["usageStartedAt"])); if startedAt.IsZero() { startedAt = turn.CreatedAt }; if startedAt.IsZero() { startedAt = time.Now() }
			if a.recordUsage(text(detail["usageId"]), GenerationTask{UserID: turn.UserID, ProjectID: turn.ProjectID}, turn.ID, startedAt, object(detail["usage"]), snapshot.Execution, text(detail["usageState"])) != nil { continue }
		}
		detail["usageRecordPending"] = false
		a.db.Model(&AssistantItem{}).Where("thread_id = ? AND turn_id = ? AND id = ?", item.ThreadID, item.TurnID, item.ID).Update("detail", encode(detail))
	}
}

type optionalIntegerString struct { Set bool; Value *string }

func (value *optionalIntegerString) UnmarshalJSON(raw []byte) error {
	value.Set = true
	if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) { value.Value = nil; return nil }
	var parsed string
	if err := json.Unmarshal(raw, &parsed); err != nil { return err }
	value.Value = &parsed; return nil
}

type usageCorrectionInput struct { CostMicros optionalIntegerString `json:"costMicros"`; PointsMilli optionalIntegerString `json:"pointsMilli"`; Reason string `json:"reason"` }

func (a *App) correctUsage(c *gin.Context) {
	var input usageCorrectionInput; if !bind(c, &input) { return }; if err := a.CorrectUsage(currentUser(c).ID, c.Param("id"), input); err != nil { respondError(c, err); return }; c.Status(204)
}

func (a *App) CorrectUsage(adminID, id string, input usageCorrectionInput) error {
	if !input.CostMicros.Set && !input.PointsMilli.Set { return problem(400, "invalid_correction", "请至少修正成本或积分") }
	parse := func(value *string) (*int64, error) { if value == nil { return nil, nil }; integer, err := strconv.ParseInt(*value, 10, 64); if err != nil || integer < 0 { return nil, problem(400, "invalid_correction", "金额和积分需要可表示的非负整数") }; return &integer, nil }
	cost, err := parse(input.CostMicros.Value); if err != nil { return err }; points, err := parse(input.PointsMilli.Value); if err != nil { return err }
	if strings.TrimSpace(input.Reason) == "" { return problem(400, "invalid_correction", "请填写修正依据") }
	err = a.db.Transaction(func(tx *gorm.DB) error {
		var entry UsageEntry
		if err := tx.First(&entry, "id = ?", id).Error; err != nil { return err }
		before := encode(entry)
		if input.CostMicros.Set { entry.CostMicros = cost; entry.CostState = "corrected" }
		if input.PointsMilli.Set { entry.PointsMilli = points }
		entry.Corrected = true
		if err := tx.Save(&entry).Error; err != nil { return err }
		return tx.Create(&UsageCorrection{ID: identifier(), EntryID: entry.ID, AdminID: adminID, Before: before, After: encode(entry), Reason: strings.TrimSpace(input.Reason)}).Error
	})
	return err
}

func (a *App) usageCorrections(c *gin.Context) {
	rows := []UsageCorrection{}
	if err := a.db.Where("entry_id = ?", c.Param("id")).Order("created_at").Find(&rows).Error; err != nil { respondError(c, err); return }
	c.JSON(200, rows)
}

func publicUsageJSON(raw JSON) (usageEntryView, error) {
	var value usageEntryView
	var source struct { Pricing JSON `json:"pricing"` }
	if err := json.Unmarshal(raw, &source); err != nil { return value, err }
	if err := json.Unmarshal(raw, &value); err != nil { return value, err }
	pricing, err := parseModelPricing(source.Pricing); if err != nil { return value, err }
	var snapshot struct { PointsPerYuan string `json:"pointsPerYuan"` }
	if err := json.Unmarshal(source.Pricing, &snapshot); err != nil { return value, err }
	value.Pricing = projectPublicModelPricing(source.Pricing, snapshot.PointsPerYuan)
	value.Usage = publicUsageValues(value.Usage, pricing)
	return value, nil
}

func (a *App) usageCorrectionsForUser(c *gin.Context) {
	var entry UsageEntry
	if err := a.db.First(&entry, "id = ? AND user_id = ?", c.Param("id"), currentUser(c).ID).Error; err != nil { respondError(c, err); return }
	rows := []UsageCorrection{}
	if err := a.db.Where("entry_id = ?", entry.ID).Order("created_at").Find(&rows).Error; err != nil { respondError(c, err); return }
	result := []gin.H{}
	for _, row := range rows {
		before, err := publicUsageJSON(row.Before); if err != nil { respondError(c, err); return }
		after, err := publicUsageJSON(row.After); if err != nil { respondError(c, err); return }
		result = append(result, gin.H{"id": row.ID, "entryId": row.EntryID, "adminId": row.AdminID, "before": before, "after": after, "createdAt": row.CreatedAt})
	}
	c.JSON(200, result)
}
