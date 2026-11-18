package app

import (
	"encoding/json"
	"math"
	"sort"

	"gorm.io/gorm"
)

func defaultAdapter(capability string) string { return map[string]string{"text": "openai-chat", "image": "openai-image", "video": "openai-video", "audio": "openai-tts"}[capability] }

func scriptFeatures(files JSON) JSON { manifest, _, _, err := readScriptPackage(files); if err != nil { return JSON(`{}`) }; return encode(manifest.Features) }

func modelFeatures(db *gorm.DB, model ChannelModel) JSON { var version ScriptVersion; if db.Select("features").First(&version, "id = ? AND adapter_id = ?", model.AdapterVersionID, model.AdapterID).Error != nil { return JSON(`{}`) }; return version.Features }

func hydrateModel(db *gorm.DB, model *ChannelModel) error {
	var version ScriptVersion
	if err := db.Select("parameters").First(&version, "id = ? AND adapter_id = ?", model.AdapterVersionID, model.AdapterID).Error; err != nil { return problem(409, "script_version_missing", "模型绑定的脚本版本不可用，请重新选择调用方式") }
	definitions, err := effectiveParameters(version.Parameters, model.ParameterOverrides); if err == nil { model.Parameters = definitions }; return err
}

// Overrides only configure existing inputs. Field identity and API meaning belong to the script version.
func effectiveParameters(definitions, overrides JSON) (JSON, error) {
	var controls []parameterControl; var changes map[string]map[string]any
	if json.Unmarshal(definitions, &controls) != nil { return nil, problem(409, "invalid_parameters", "脚本输入定义无法读取") }
	if len(overrides) == 0 { overrides = JSON(`{}`) }
	if json.Unmarshal(overrides, &changes) != nil || changes == nil { return nil, problem(400, "invalid_parameter_overrides", "参数覆盖需要按字段保存的对象") }
	indexes := map[string]int{}; for index, control := range controls { indexes[control.Key] = index }
	for key, change := range changes {
		index, exists := indexes[key]; if !exists { return nil, problem(400, "undeclared_parameter", "脚本未声明参数："+key) }
		var fields map[string]any; _ = json.Unmarshal(encode(controls[index]), &fields)
		for name, value := range change {
			if !includes([]string{"label", "labelEn", "description", "descriptionEn", "default", "hidden", "advanced", "order", "options", "min", "max", "required"}, name) { return nil, problem(400, "invalid_parameter_override", "不能覆盖输入字段："+name) }
			if name == "required" && controls[index].Required && value != true { return nil, problem(400, "invalid_parameter_override", "不能取消脚本必填要求") }
			if name == "min" || name == "max" { number, ok := value.(float64); if !ok || name == "min" && controls[index].Min != nil && number < *controls[index].Min || name == "max" && controls[index].Max != nil && number > *controls[index].Max { return nil, problem(400, "invalid_parameter_override", "模型范围不能超出脚本约束") } }
			if name == "options" { if !includes([]string{"select", "text", "textarea", "number"}, controls[index].Type) { return nil, problem(400, "invalid_parameter_override", "只有选择、文本或数字参数可以设置可用选项") }; options, ok := value.([]any); if !ok { return nil, problem(400, "invalid_parameter_override", "可用选项需要数组") }; if len(controls[index].Options) > 0 && len(options) == 0 { return nil, problem(400, "invalid_parameter_override", "不能移除脚本的选项约束") }; for _, option := range options { if err := validateParameterValue(controls[index], object(option)["value"]); err != nil { return nil, err } }; if len(options) > 0 { fields["suggestions"] = nil } }
			if name == "min" && controls[index].Step != nil { start := 0.0; if controls[index].Min != nil { start = *controls[index].Min }; steps := (value.(float64)-start)/ *controls[index].Step; if math.Abs(steps-math.Round(steps)) > 1e-9 { return nil, problem(400, "invalid_parameter_override", "模型最小值必须符合脚本原有步长") } }
			fields[name] = value
		}
		var updated parameterControl
		if json.Unmarshal(encode(fields), &updated) != nil { return nil, problem(400, "invalid_parameter_override", "参数覆盖类型不正确") }
		suggestions := updated.Suggestions; updated.Suggestions = nil
		for _, option := range suggestions { if validateParameterValue(updated, option.Value) == nil { updated.Suggestions = append(updated.Suggestions, option) } }
		controls[index] = updated
	}
	sort.SliceStable(controls, func(i, j int) bool { return controls[i].Order < controls[j].Order })
	raw := encode(controls); if err := validateParameters(raw, true); err != nil { return nil, err }; return raw, nil
}

func parameterVisible(control parameterControl, values map[string]any) bool {
	if control.When == nil { return true }
	actual := string(encode(values[control.When.Key]))
	for _, expected := range control.When.Values { if string(encode(expected)) == actual { return true } }
	return false
}

func objectFromJSON(raw JSON) map[string]any { value := map[string]any{}; _ = json.Unmarshal(raw, &value); return value }
