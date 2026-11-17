package app

import (
	"encoding/json"
	"math/big"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func decimalValue(value string) (*big.Rat, bool) {
	if !decimalPattern.MatchString(value) { return nil, false }
	result, ok := new(big.Rat).SetString(value)
	return result, ok && result.Sign() >= 0
}

var decimalPattern = regexp.MustCompile(`^\d+(?:\.\d+)?$`)
var currencyPattern = regexp.MustCompile(`^[A-Z]{3}$`)

func scaledInteger(value *big.Rat, scale int64) *int64 {
	scaled := new(big.Rat).Mul(value, new(big.Rat).SetInt64(scale))
	integer := new(big.Int).Quo(scaled.Num(), scaled.Denom())
	if !integer.IsInt64() { return nil }
	result := integer.Int64(); return &result
}

// Prices are decimal strings; currency and points are stored as integer minor units.
// A missing price or usage stays unknown rather than becoming zero.
func usageCost(usage map[string]any, pricing map[string]any, pointsRatio string) (*int64, *int64, *int64) {
	total := new(big.Rat)
	pointsTotal, pointsMatched, pointsKnown := new(big.Rat), false, true
	matched, costKnown := false, true
	for unit, rate := range object(pricing["rates"]) {
		quantity := text(usage[unit])
		if unit == "input_tokens" && object(pricing["rates"])["cached_tokens"] != nil { quantity = text(usage["uncached_input_tokens"]) }
		if quantity == "" { return nil, nil, nil }
		count, ok := decimalValue(quantity); if !ok { return nil, nil, nil }
		per, ok := decimalValue(text(object(rate)["per"])); if !ok || per.Sign() == 0 { return nil, nil, nil }
		if price, ok := decimalValue(text(object(rate)["amount"])); ok { total.Add(total, new(big.Rat).Quo(new(big.Rat).Mul(count, price), per)); matched = true } else { costKnown = false }
		if price, ok := decimalValue(text(object(rate)["points"])); ok { pointsTotal.Add(pointsTotal, new(big.Rat).Quo(new(big.Rat).Mul(count, price), per)); pointsMatched = true } else { pointsKnown = false }
	}
	var cost, original *int64
	yuan := new(big.Rat)
	if matched && costKnown { original = scaledInteger(total, 1000000); if text(pricing["currency"]) == "CNY" { yuan.Set(total); cost = scaledInteger(yuan, 1000000) } else if exchange, ok := decimalValue(text(pricing["exchangeRate"])); ok && exchange.Sign() > 0 { yuan.Mul(total, exchange); cost = scaledInteger(yuan, 1000000) } }
	if pointsMatched && pointsKnown { return cost, scaledInteger(pointsTotal, 1000), original }
	if !pointsMatched && cost != nil { if ratio, ok := decimalValue(pointsRatio); ok { return cost, scaledInteger(new(big.Rat).Mul(yuan, ratio), 1000), original } }
	return cost, nil, original
}

func validatePricing(pricing map[string]any) error {
	if len(object(pricing["rates"])) > 0 {
		currency := text(pricing["currency"]); if !currencyPattern.MatchString(currency) { return problem(400, "invalid_currency", "请填写三位大写成本币种，例如 CNY 或 USD") }
		if value := pricing["exchangeRate"]; value != nil { exchange, ok := decimalValue(text(value)); if !ok || exchange.Sign() <= 0 || currency == "CNY" && exchange.Cmp(big.NewRat(1, 1)) != 0 { return problem(400, "invalid_exchange_rate", "exchangeRate 为每单位原币对应的人民币元；人民币只能为 1，外币留空表示换算未知") } }
	}
	if value, exists := pricing["rates"]; exists { if _, ok := value.(map[string]any); !ok { return problem(400, "invalid_price", "rates 需要按计量单位定义的对象") } }
	for unit, value := range object(pricing["rates"]) {
		if unit == "" { return problem(400, "invalid_price", "计价单位不能为空") }
		rate := object(value)
		for _, key := range []string{"amount", "points"} { if value := rate[key]; value != nil { if _, ok := decimalValue(text(value)); !ok { return problem(400, "invalid_price", "单价需要非负十进制数") } } }
		if per, ok := decimalValue(text(rate["per"])); !ok || per.Sign() == 0 { return problem(400, "invalid_price", "计价数量 per 需要大于零的十进制数") }
	}
	return nil
}

func normalizeUsage(usage map[string]any) map[string]any {
	if usage == nil { return map[string]any{} }
	if value, ok := usage["prompt_tokens"]; ok { usage["input_tokens"] = value }
	if value, ok := usage["completion_tokens"]; ok { usage["output_tokens"] = value }
	if cached, ok := object(usage["prompt_tokens_details"])["cached_tokens"]; ok { usage["cached_tokens"] = cached }
	if cached, ok := object(usage["input_tokens_details"])["cached_tokens"]; ok { usage["cached_tokens"] = cached }
	if input, ok := decimalValue(text(usage["input_tokens"])); ok { if cached, ok := decimalValue(text(usage["cached_tokens"])); ok && input.Cmp(cached) >= 0 { usage["uncached_input_tokens"] = new(big.Rat).Sub(input, cached).FloatString(0) } }
	return usage
}

func (a *App) recordUsage(id string, task GenerationTask, turnID string, usage map[string]any, snapshot executionSnapshot, state string) error {
	usage = normalizeUsage(usage)
	if len(usage) == 0 { state = "unknown" }
	pricing := map[string]any{}
	_ = json.Unmarshal(snapshot.Model.Pricing, &pricing)
	cost, points, original := usageCost(usage, pricing, snapshot.Policy.PointsPerYuan)
	priceSnapshot := encode(map[string]any{"rates": pricing["rates"], "pointsPerYuan": snapshot.Policy.PointsPerYuan, "currency": pricing["currency"], "exchangeRate": pricing["exchangeRate"]})
	costState := "estimated"; if cost == nil { costState = "unknown" }
	entry := UsageEntry{ID: id, UserID: task.UserID, ProjectID: task.ProjectID, TaskID: task.ID, TurnID: turnID, ChannelID: snapshot.ChannelID, ModelID: snapshot.Model.ID, Capability: snapshot.Model.Capability, State: state, Usage: encode(usage), Pricing: priceSnapshot, CostMicros: cost, OriginalCostMicros: original, Currency: text(pricing["currency"]), CostState: costState, PointsMilli: points}
	err := a.db.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "id"}}, DoUpdates: clause.AssignmentColumns([]string{"state", "usage", "cost_micros", "original_cost_micros", "cost_state", "points_milli", "updated_at"}), Where: clause.Where{Exprs: []clause.Expression{clause.Eq{Column: "corrected", Value: false}}}}).Create(&entry).Error
	if err == nil { a.notify(task.UserID) }
	return err
}

func (a *App) listUsage(c *gin.Context) {
	filters := map[string]string{}; for _, key := range []string{"userId", "projectId", "channelId", "modelId", "capability", "from", "to"} { filters[key] = c.Query(key) }
	userID := currentUser(c).ID; if currentUser(c).Role == "admin" && strings.HasPrefix(c.FullPath(), "/api/admin/") { userID = "" }
	value, err := a.ListUsage(userID, nil, filters); if err != nil { respondError(c, err); return }; c.JSON(200, value)
}

func (a *App) ListUsage(userID string, projects []string, filters map[string]string) (gin.H, error) {
	query := a.db.Model(&UsageEntry{})
	if userID != "" { query = query.Where("user_id = ?", userID) }; if len(projects) > 0 { query = query.Where("project_id IN ?", projects) }
	for key, column := range map[string]string{"userId": "user_id", "projectId": "project_id", "channelId": "channel_id", "modelId": "model_id", "capability": "capability"} { if value := filters[key]; value != "" { query = query.Where(column+" = ?", value) } }
	entries := []UsageEntry{}
	for _, key := range []string{"from", "to"} { if value := filters[key]; value != "" { parsed, err := time.Parse(time.RFC3339Nano, value); if err != nil { return nil, problem(400, "invalid_date", "统计日期需要完整时区时间") }; operator := ">="; if key == "to" { operator = "<=" }; query = query.Where("created_at "+operator+" ?", parsed) } }
	if err := query.Order("created_at DESC").Find(&entries).Error; err != nil { return nil, err }
	cost, points := new(big.Int), new(big.Int)
	unknown, unknownPoints := 0, 0
	for _, entry := range entries { if entry.CostMicros == nil { unknown++ } else { cost.Add(cost, big.NewInt(*entry.CostMicros)) }; if entry.PointsMilli == nil { unknownPoints++ } else { points.Add(points, big.NewInt(*entry.PointsMilli)) } }
	return gin.H{"entries": entries, "costMicros": cost.String(), "pointsMilli": points.String(), "unknownCostCount": unknown, "unknownPointsCount": unknownPoints}, nil
}

func (a *App) repairAssistantUsage() {
	var items []AssistantItem
	if a.db.Where("json_extract(detail, '$.usageRecordPending') = ? AND turn_id IN (?)", true, a.db.Model(&AssistantTurn{}).Select("id").Where("status IN ?", []string{"interrupted", "failed", "cancelled", "succeeded"})).Find(&items).Error != nil { return }
	for _, item := range items {
		var detail map[string]any; var turn AssistantTurn; var snapshot assistantSnapshot
		if json.Unmarshal(item.Detail, &detail) != nil || text(detail["usageId"]) == "" || a.db.First(&turn, "id = ? AND user_id = ?", item.TurnID, item.UserID).Error != nil || json.Unmarshal(turn.Snapshot, &snapshot) != nil { continue }
		if a.recordUsage(text(detail["usageId"]), GenerationTask{UserID: turn.UserID, ProjectID: turn.ProjectID}, turn.ID, object(detail["usage"]), snapshot.Execution, text(detail["usageState"])) != nil { continue }
		detail["usageRecordPending"] = false
		a.db.Model(&AssistantItem{}).Where("thread_id = ? AND turn_id = ? AND id = ?", item.ThreadID, item.TurnID, item.ID).Update("detail", encode(detail))
	}
}

type usageCorrectionInput struct { CostMicros *string `json:"costMicros"`; PointsMilli *string `json:"pointsMilli"`; Reason string `json:"reason"` }

func (a *App) correctUsage(c *gin.Context) {
	var input usageCorrectionInput; if !bind(c, &input) { return }; if err := a.CorrectUsage(currentUser(c).ID, c.Param("id"), input); err != nil { respondError(c, err); return }; c.Status(204)
}

func (a *App) CorrectUsage(adminID, id string, input usageCorrectionInput) error {
	parse := func(value *string) (*int64, error) { if value == nil { return nil, nil }; integer, err := strconv.ParseInt(*value, 10, 64); if err != nil || integer < 0 { return nil, problem(400, "invalid_correction", "金额和积分需要可表示的非负整数") }; return &integer, nil }
	cost, err := parse(input.CostMicros); if err != nil { return err }; points, err := parse(input.PointsMilli); if err != nil { return err }
	if strings.TrimSpace(input.Reason) == "" { return problem(400, "invalid_correction", "请填写修正依据") }
	err = a.db.Transaction(func(tx *gorm.DB) error {
		var entry UsageEntry
		if err := tx.First(&entry, "id = ?", id).Error; err != nil { return err }
		before := encode(entry)
		entry.CostMicros, entry.PointsMilli, entry.Corrected = cost, points, true
		entry.CostState = "corrected"
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
