package app

import (
	"encoding/json"
	"net/url"
	"regexp"
	"strings"
)

var assistantCredentialPattern = regexp.MustCompile(`(?i)\b(?:sk-[a-z0-9_-]+|dc_[a-f0-9]{64}|bearer\s+[a-z0-9._~+/=-]+)`)
var assistantURLPattern = regexp.MustCompile(`https?://[^\s<>"'\\]+`)
var assistantSecretAssignment = regexp.MustCompile(`(?i)(["']?(?:api[_-]?key|access[_-]?key[_-]?secret|secret[_-]?key|authorization|password|credential|token)["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}]+)`)
var assistantLabelURL = regexp.MustCompile(`(?i)(?:https?://|file://|blob:|data:)[^\s<>"'\\]+`)

func redactAssistantLabel(value string, redact func(string) string) string {
	if strings.TrimSpace(value) == "" { return "" }
	return redact(assistantLabelURL.ReplaceAllString(value, "[REDACTED URL]"))
}

func compactAssistantLabel(value string, limit int) string {
	value = strings.Join(strings.Fields(value), " ")
	if chars := []rune(value); len(chars) > limit { return strings.TrimSpace(string(chars[:limit-1])) + "…" }
	return value
}

func assistantTextOnlyParameters(snapshot assistantSnapshot, redact func(any) any) (map[string]any, error) {
	parameters := object(redact(snapshot.Parameters))
	delete(parameters, "systemPrompt")
	var controls []parameterControl
	if err := json.Unmarshal(snapshot.Execution.Model.Parameters, &controls); err != nil { return nil, err }
	for _, control := range controls { if control.Type == "asset" { delete(parameters, control.Key) } }
	return parameters, nil
}

// Redact copies sent to models or shown in the timeline without changing private history.
func (a *App) assistantRedactor(snapshot executionSnapshot) (func(any) any, error) {
	channels := []Channel{}; storages := []ObjectStorage{}
	if err := a.db.Select("secret").Find(&channels).Error; err != nil { return nil, err }
	if err := a.db.Select("access_key_id", "secret").Find(&storages).Error; err != nil { return nil, err }
	secrets := []string{}; encrypted := []string{snapshot.Credential}
	for _, channel := range channels { encrypted = append(encrypted, channel.Secret) }; for _, storage := range storages { encrypted = append(encrypted, storage.AccessKeyID, storage.Secret) }
	for _, value := range encrypted { if value == "" { continue }; plain, err := a.decryptSecret(value); if err != nil { return nil, err }; if plain != "" && !includes(secrets, plain) { secrets = append(secrets, plain) } }
	clean := func(value string) string {
		for _, secret := range secrets { value = strings.ReplaceAll(value, secret, "[REDACTED]") }
		value = assistantCredentialPattern.ReplaceAllString(value, "[REDACTED]")
		value = assistantSecretAssignment.ReplaceAllString(value, `${1}"[REDACTED]"`)
		return assistantURLPattern.ReplaceAllStringFunc(value, func(address string) string {
			u, err := url.Parse(address); if err != nil { return "[REDACTED URL]" }; u.User = nil
			query, err := url.ParseQuery(u.RawQuery); if err != nil { return "[REDACTED URL]" }
			for key := range query { lower := strings.ToLower(key); if strings.Contains(lower, "token") || strings.Contains(lower, "secret") || strings.Contains(lower, "credential") || strings.Contains(lower, "signature") || strings.Contains(lower, "accesskey") || strings.Contains(lower, "api_key") || strings.Contains(lower, "apikey") || lower == "sign" || lower == "key" || lower == "q-ak" { query.Set(key, "[REDACTED]") } }
			u.RawQuery = query.Encode(); return u.String()
		})
	}
	var visit func(any) any
	visit = func(value any) any { switch value := value.(type) {
		case string: return clean(value)
		case []any: result := make([]any, len(value)); for index, item := range value { result[index] = visit(item) }; return result
		case map[string]any: result := map[string]any{}; for key, item := range value { switch strings.ToLower(key) { case "credential", "password", "currentpassword", "accesskeyid", "accesskeysecret", "secret", "apikey", "api_key", "authorization", "token": result[key] = "[REDACTED]"; default: result[key] = visit(item) } }; return result
	}; return value }
	return visit, nil
}

func (a *App) assistantMaterials(snapshot assistantSnapshot) ([]map[string]any, map[string]any, error) {
	redact, err := a.assistantRedactor(snapshot.Execution); if err != nil { return nil, nil, err }
	var raw any; if err := json.Unmarshal(encode(map[string]any{"messages": snapshot.Messages, "parameters": snapshot.Parameters}), &raw); err != nil { return nil, nil, err }
	var result struct { Messages []map[string]any `json:"messages"`; Parameters map[string]any `json:"parameters"` }
	err = json.Unmarshal(encode(redact(raw)), &result)
	var controls []parameterControl; if err == nil { err = json.Unmarshal(snapshot.Execution.Model.Parameters, &controls) }
	for _, control := range controls { if control.Type == "asset" { if value, exists := snapshot.Parameters[control.Key]; exists { result.Parameters[control.Key] = value } } }
	normalizeArguments := func(call map[string]any) {
		if assistantToolArguments(call["arguments"]) == nil { call["arguments"] = "{}" }
	}
	for _, message := range result.Messages {
		for _, call := range array(message["tool_calls"]) { normalizeArguments(object(object(call)["function"])) }
		for _, rawItem := range array(message["responseItems"]) {
			item := object(rawItem)
			if item["type"] == "function_call" { normalizeArguments(item) }
		}
	}
	return result.Messages, result.Parameters, err
}
