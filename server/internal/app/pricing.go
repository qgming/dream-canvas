package app

import (
	"encoding/json"
	"math/big"
	"regexp"
	"strings"

	"gorm.io/gorm"
)

type pricingRate struct {
	Per string `json:"per"`
	Amount string `json:"amount,omitempty"`
	Points string `json:"points,omitempty"`
}

type pricingTier struct {
	ID string `json:"id,omitempty"`
	Conditions map[string]any `json:"conditions"`
	Rates map[string]pricingRate `json:"rates"`
}

type modelPricing struct {
	Currency string `json:"currency,omitempty"`
	ExchangeRate string `json:"exchangeRate,omitempty"`
	Rates map[string]pricingRate `json:"rates,omitempty"`
	Tiers []pricingTier `json:"tiers,omitempty"`
}

type publicPricingRate struct {
	Per string `json:"per"`
	Points string `json:"points,omitempty"`
}

type publicPricingTier struct {
	ID string `json:"id,omitempty"`
	Conditions map[string]any `json:"conditions"`
	Rates map[string]publicPricingRate `json:"rates"`
}

type publicModelPricing struct {
	Rates map[string]publicPricingRate `json:"rates,omitempty"`
	Tiers []publicPricingTier `json:"tiers,omitempty"`
}

var decimalPattern = regexp.MustCompile(`^\d+(?:\.\d+)?$`)
var currencyPattern = regexp.MustCompile(`^[A-Z]{3}$`)

func decimalValue(value string) (*big.Rat, bool) {
	if !decimalPattern.MatchString(value) { return nil, false }
	result, ok := new(big.Rat).SetString(value)
	return result, ok && result.Sign() >= 0
}

func scaledInteger(value *big.Rat, scale int64) *int64 {
	scaled := new(big.Rat).Mul(value, new(big.Rat).SetInt64(scale))
	integer := new(big.Int).Quo(scaled.Num(), scaled.Denom())
	if !integer.IsInt64() { return nil }
	result := integer.Int64(); return &result
}

func decimalText(value *big.Rat, precision int) string {
	result := value.FloatString(precision)
	if strings.Contains(result, ".") { result = strings.TrimRight(strings.TrimRight(result, "0"), ".") }
	if result == "-0" || result == "" { return "0" }
	return result
}

func parseModelPricing(raw JSON) (modelPricing, error) {
	pricing := modelPricing{}
	if len(raw) == 0 { return pricing, nil }
	if json.Unmarshal(raw, &pricing) != nil { return pricing, problem(400, "invalid_pricing", "价格定义需要对象") }
	return pricing, nil
}

func validatePricing(raw JSON, definitions JSON) error {
	pricing, err := parseModelPricing(raw)
	if err != nil { return problem(400, "invalid_pricing", "价格定义需要对象") }
	currency := pricing.Currency
	if currency != "" && !currencyPattern.MatchString(currency) { return problem(400, "invalid_currency", "请填写三位大写成本币种，例如 CNY 或 USD") }
	if value := pricing.ExchangeRate; value != "" {
		exchange, ok := decimalValue(value)
		if !ok || exchange.Sign() <= 0 || currency == "CNY" && exchange.Cmp(big.NewRat(1, 1)) != 0 { return problem(400, "invalid_exchange_rate", "exchangeRate 为每单位原币对应的人民币元；人民币只能为 1，外币留空表示换算未知") }
	}
	usesAmount, err := validateRateSet(pricing.Rates)
	if err != nil { return err }
	var controls []parameterControl
	if json.Unmarshal(definitions, &controls) != nil { return problem(409, "invalid_parameters", "脚本输入定义无法读取") }
	indexes := map[string]parameterControl{}; for _, control := range controls { indexes[control.Key] = control }
	ids := map[string]bool{}
	for index := range pricing.Tiers {
		tier := &pricing.Tiers[index]
		if tier.ID != "" && ids[tier.ID] { return problem(400, "invalid_pricing", "价格档位 id 不能重复") }
		ids[tier.ID] = true
		if len(tier.Conditions) == 0 { return problem(400, "invalid_pricing", "条件价格档位至少需要一个参数条件") }
		for key, expected := range tier.Conditions {
			control, exists := indexes[key]
			if !exists { return problem(400, "invalid_pricing", "价格条件引用了脚本未声明的参数："+key) }
			if control.Type == "asset" || control.Type == "reference" { return problem(400, "invalid_pricing", "价格条件只能引用普通标量参数") }
			if !scalarValue(expected) || !usableParameterValue(control, expected) { return problem(400, "invalid_pricing", "价格条件「"+key+"」无法由有效参数满足") }
		}
		if !pricingConditionsCanMatch(tier.Conditions, indexes) { return problem(400, "invalid_pricing", "价格档位内多个条件无法同时成立") }
		tierUsesAmount, err := validateRateSet(tier.Rates)
		if err != nil { return err }
		if tierUsesAmount { usesAmount = true }
	}
	for left := 0; left < len(pricing.Tiers); left++ {
		for right := left + 1; right < len(pricing.Tiers); right++ {
			if pricingTiersOverlap(pricing.Tiers[left], pricing.Tiers[right], indexes) { return problem(400, "invalid_pricing", "两个价格档位的条件可能同时成立，无法确定价格") }
		}
	}
	if (usesAmount || pricing.ExchangeRate != "") && !currencyPattern.MatchString(currency) { return problem(400, "invalid_currency", "配置成本金额时需要三位大写成本币种") }
	return nil
}

func validateRateSet(rates map[string]pricingRate) (bool, error) {
	usesAmount := false
	for unit, rate := range rates {
		if unit == "" { return false, problem(400, "invalid_price", "计价单位不能为空") }
		for _, value := range []string{rate.Amount, rate.Points} {
			if value != "" { if _, ok := decimalValue(value); !ok { return false, problem(400, "invalid_price", "单价需要非负十进制数") } }
		}
		if per, ok := decimalValue(rate.Per); !ok || per.Sign() == 0 { return false, problem(400, "invalid_price", "计价数量 per 需要大于零的十进制数") }
		if rate.Amount != "" { usesAmount = true }
	}
	return usesAmount, nil
}

func scalarValue(value any) bool {
	switch value.(type) {
	case string, bool, float64, float32, int, int64, json.Number:
		return true
	default:
		return false
	}
}

func scalarEqual(left, right any) bool {
	if !scalarValue(left) || !scalarValue(right) { return false }
	return string(encode(left)) == string(encode(right))
}

func usableParameterValue(control parameterControl, value any) bool {
	if validateParameterValue(control, value) != nil { return false }
	if text, ok := value.(string); ok && strings.TrimSpace(text) == "" { return false }
	return true
}

func pricingConditionsCanMatch(conditions map[string]any, controls map[string]parameterControl) bool {
	parents := map[string]map[string]any{}
	for key, expected := range conditions {
		control, ok := controls[key]
		if !ok || control.Type == "asset" || control.Type == "reference" || !scalarValue(expected) || !usableParameterValue(control, expected) { return false }
		if control.Hidden && (control.Default == nil || !scalarEqual(control.Default, expected)) { return false }
		if control.When == nil { continue }
		parent, ok := controls[control.When.Key]; if !ok || parent.When != nil || parent.Type == "asset" || parent.Type == "reference" { return false }
		allowed := map[string]any{}
		for _, value := range control.When.Values {
			if scalarValue(value) && usableParameterValue(parent, value) { allowed[string(encode(value))] = value }
		}
		if previous := parents[control.When.Key]; previous == nil { parents[control.When.Key] = allowed
		} else {
			for encoded := range previous { if _, exists := allowed[encoded]; !exists { delete(previous, encoded) } }
		}
	}
	for key, allowed := range parents {
		parent := controls[key]
		if parent.Hidden {
			for encoded, value := range allowed { if parent.Default == nil || !scalarEqual(parent.Default, value) { delete(allowed, encoded) } }
		}
		if expected, exists := conditions[key]; exists {
			for encoded, value := range allowed { if !scalarEqual(expected, value) { delete(allowed, encoded) } }
		}
		if len(allowed) == 0 { return false }
	}
	return true
}

func pricingTiersOverlap(left, right pricingTier, controls map[string]parameterControl) bool {
	conditions := map[string]any{}
	for _, tier := range []pricingTier{left, right} {
		for key, value := range tier.Conditions {
			if existing, ok := conditions[key]; ok && !scalarEqual(existing, value) { return false }
			conditions[key] = value
		}
	}
	return pricingConditionsCanMatch(conditions, controls)
}

func ratesForParameters(pricing modelPricing, parameters map[string]any) map[string]pricingRate {
	for _, tier := range pricing.Tiers {
		matched := true
		for key, expected := range tier.Conditions { if !scalarEqual(parameters[key], expected) { matched = false; break } }
		if matched { return tier.Rates }
	}
	return pricing.Rates
}

func pointsRatioFromDB(db *gorm.DB) string {
	var record RuntimeSettings
	if db.First(&record, 1).Error != nil { return "" }
	var policy executionPolicy
	if json.Unmarshal(record.Policy, &policy) != nil { return "" }
	return policy.PointsPerYuan
}

func publicPointsText(value *big.Rat) string {
	result := decimalText(value, 18)
	if value.Sign() != 0 && result == "0" {
		formatted := new(big.Float).SetPrec(128)
		formatted.SetRat(value)
		return formatted.Text('e', 18)
	}
	return result
}

func publicRate(rate pricingRate, pricing modelPricing, pointsRatio string) publicPricingRate {
	result := publicPricingRate{Per: rate.Per}
	if rate.Points != "" {
		if points, ok := decimalValue(rate.Points); ok { result.Points = publicPointsText(points) }
		return result
	}
	amount, ok := decimalValue(rate.Amount)
	if !ok { return result }
	per, ok := decimalValue(rate.Per); if !ok || per.Sign() == 0 { return result }
	local := new(big.Rat).Quo(amount, per)
	if local.Sign() == 0 { result.Per, result.Points = "1", "0"; return result }
	yuan := new(big.Rat).Set(local)
	if pricing.Currency != "CNY" {
		exchange, ok := decimalValue(pricing.ExchangeRate); if !ok || exchange.Sign() == 0 { return result }
		yuan.Mul(yuan, exchange)
	}
	if yuan.Sign() != 0 {
		ratio, ok := decimalValue(pointsRatio); if !ok { return result }
		yuan.Mul(yuan, ratio)
	}
	result.Per, result.Points = "1", publicPointsText(yuan)
	return result
}

func projectRates(rates map[string]pricingRate, pricing modelPricing, pointsRatio string) map[string]publicPricingRate {
	if len(rates) == 0 { return map[string]publicPricingRate{} }
	result := map[string]publicPricingRate{}
	for unit, rate := range rates { result[unit] = publicRate(rate, pricing, pointsRatio) }
	return result
}

func projectPublicModelPricing(raw JSON, pointsRatio string) publicModelPricing {
	pricing, err := parseModelPricing(raw); if err != nil { return publicModelPricing{} }
	result := publicModelPricing{Rates: projectRates(pricing.Rates, pricing, pointsRatio)}
	for _, tier := range pricing.Tiers {
		result.Tiers = append(result.Tiers, publicPricingTier{ID: tier.ID, Conditions: tier.Conditions, Rates: projectRates(tier.Rates, pricing, pointsRatio)})
	}
	return result
}

func pricingSnapshot(pricing modelPricing, pointsRatio string) JSON {
	return encode(map[string]any{
		"currency": pricing.Currency,
		"exchangeRate": pricing.ExchangeRate,
		"rates": pricing.Rates,
		"tiers": pricing.Tiers,
		"pointsPerYuan": pointsRatio,
	})
}

func rateTotals(quantities map[string]*big.Rat, rates map[string]pricingRate, pricing modelPricing, pointsRatio string) (*int64, *int64, *int64) {
	if len(rates) == 0 { return nil, nil, nil }
	originalTotal, yuanTotal, pointsTotal := new(big.Rat), new(big.Rat), new(big.Rat)
	originalKnown, costKnown, pointsKnown := true, true, true
	for unit, rate := range rates {
		quantity, ok := quantities[unit]; if !ok { return nil, nil, nil }
		per, ok := decimalValue(rate.Per); if !ok || per.Sign() == 0 { return nil, nil, nil }
		var local, yuan *big.Rat
		if amount, ok := decimalValue(rate.Amount); ok {
			local = new(big.Rat).Quo(new(big.Rat).Mul(quantity, amount), per)
			originalTotal.Add(originalTotal, local)
			yuan = new(big.Rat).Set(local)
			if pricing.Currency != "CNY" && local.Sign() != 0 {
				exchange, ok := decimalValue(pricing.ExchangeRate)
				if !ok || exchange.Sign() == 0 { costKnown = false; yuan = nil } else { yuan.Mul(yuan, exchange) }
			}
			if yuan != nil { yuanTotal.Add(yuanTotal, yuan) }
		} else { originalKnown, costKnown = false, false }
		if rate.Points != "" {
			points, ok := decimalValue(rate.Points); if !ok { pointsKnown = false } else { pointsTotal.Add(pointsTotal, new(big.Rat).Quo(new(big.Rat).Mul(quantity, points), per)) }
		} else if local == nil { pointsKnown = false
		} else {
			if yuan == nil { pointsKnown = false
			} else if yuan.Sign() != 0 {
				ratio, ok := decimalValue(pointsRatio); if !ok { pointsKnown = false } else { pointsTotal.Add(pointsTotal, new(big.Rat).Mul(yuan, ratio)) }
			}
		}
	}
	var cost, original, points *int64
	if originalKnown { original = scaledInteger(originalTotal, 1000000) }
	if costKnown {
		if pricing.Currency == "CNY" { cost = scaledInteger(originalTotal, 1000000) } else { cost = scaledInteger(yuanTotal, 1000000) }
	}
	if pointsKnown { points = scaledInteger(pointsTotal, 1000) }
	return cost, points, original
}

func usageCost(usage map[string]any, pricing modelPricing, pointsRatio string, parameters map[string]any) (*int64, *int64, *int64) {
	rates := ratesForParameters(pricing, parameters)
	quantities := map[string]*big.Rat{}
	for unit := range rates {
		value := text(usage[unit])
		if unit == "input_tokens" && rates["cached_tokens"].Per != "" { value = text(usage["uncached_input_tokens"]) }
		quantity, ok := decimalValue(value); if !ok { return nil, nil, nil }
		quantities[unit] = quantity
	}
	return rateTotals(quantities, rates, pricing, pointsRatio)
}
