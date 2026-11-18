package app

import (
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func (a *App) getModelScriptEvidence(c *gin.Context) {
	value, err := a.ModelScriptEvidence(currentUser(c).ID, c.Param("adapterId"), c.Query("taskId")); if err != nil { respondError(c, err); return }; c.JSON(200, value)
}

// Debugging is a normal durable task. This reads existing evidence only; it
// never calls the provider or extends the lifetime of private raw responses.
func (a *App) ModelScriptEvidence(userID, adapterID, taskID string) (any, error) {
	var script ModelScript
	if err := a.db.First(&script, "id = ?", adapterID).Error; err != nil { return nil, err }
	tasks := []GenerationTask{}
	if err := a.db.Where("user_id = ? AND json_extract(snapshot, '$.script.adapterId') = ?", userID, adapterID).Order("created_at DESC").Find(&tasks).Error; err != nil { return nil, err }
	view := gin.H{"tasks": tasks, "task": nil, "responseState": "none"}
	if taskID == "" && len(tasks) > 0 { taskID = tasks[0].ID }
	if taskID == "" { return view, nil }
	var selected *GenerationTask
	for index := range tasks { if tasks[index].ID == taskID { selected = &tasks[index]; break } }
	if selected == nil { return nil, problem(404, "debug_task_missing", "此脚本的任务不存在或无权读取") }
	var snapshot executionSnapshot
	if json.Unmarshal(selected.Snapshot, &snapshot) != nil { return nil, problem(409, "invalid_snapshot", "调试任务快照无法读取，未覆盖原记录") }
	configuration := gin.H{"channelId": snapshot.ChannelID, "channelVersion": snapshot.ChannelVersion, "baseUrl": snapshot.BaseURL, "model": snapshot.Model, "scriptVersionId": snapshot.Model.AdapterVersionID, "draftRevision": selected.DebugRevision, "input": selected.Input}
	if snapshot.Script != nil { configuration["scriptFingerprint"] = digest(string(snapshot.Script.Files)) }
	view["configuration"], view["configurationFingerprint"] = configuration, digest(string(encode(configuration)))
	redact, err := a.assistantRedactor(snapshot); if err != nil { return nil, err }
	view["task"], view["responseState"] = selected, "unavailable"
	var usage UsageEntry; err = a.db.First(&usage, "id = ? AND user_id = ?", "task:"+selected.ID, userID).Error
	if err == nil { view["usage"] = usage } else if !errors.Is(err, gorm.ErrRecordNotFound) { return nil, err }
	if terminalTask(selected.Status) && !selected.ResponseCleanupPending && selected.RawResponseFile == "" { view["responseState"] = "cleaned"
	} else if selected.RawResponseFile != "" {
		if selected.RawResponseFile != selected.ID+".script.json" { return nil, problem(409, "invalid_response_file", "调试响应标识无效") }
		file, err := os.Open(filepath.Join(a.root, "results", selected.RawResponseFile))
		if err != nil && !errors.Is(err, os.ErrNotExist) { return nil, problem(500, "debug_response_unavailable", "调试原响应暂时无法读取，请重试") }
		if err == nil {
			defer file.Close()
			info, err := file.Stat(); if err != nil { return nil, err }
			if info.Size() > snapshot.Policy.JSONBytes || snapshot.Policy.JSONBytes <= 0 { view["responseState"] = "too_large"
			} else {
				var saved struct { Phase string `json:"phase"`; Response map[string]any `json:"response"` }
				if json.NewDecoder(io.LimitReader(file, snapshot.Policy.JSONBytes)).Decode(&saved) != nil || saved.Response == nil { return nil, problem(409, "invalid_debug_response", "调试原响应无法解析，原文件仍保留") }
				delete(saved.Response, "responseFile")
				view["phase"], view["response"], view["responseState"] = saved.Phase, debugResponseMaterial(saved.Response), "saved"
			}
		}
	}
	var encoded any; if json.Unmarshal(encode(view), &encoded) != nil { return nil, errors.New("debug evidence cannot be encoded") }
	return redact(debugResponseMaterial(encoded)), nil
}

func debugResponseMaterial(value any) any {
	switch value := value.(type) {
	case map[string]any:
		result := map[string]any{}
		for key, item := range value { if key == "b64_json" || key == "base64" || key == "dataUrl" { result[key] = "[MEDIA OMITTED]" } else { result[key] = debugResponseMaterial(item) } }; return result
	case []any:
		result := make([]any, len(value)); for index, item := range value { result[index] = debugResponseMaterial(item) }; return result
	case string:
		if strings.HasPrefix(value, "data:") { return "[MEDIA OMITTED]" }
	}
	return value
}
