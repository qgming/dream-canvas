package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"image"
	"io"
	"log/slog"
	"mime"
	"math/big"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gabriel-vasile/mimetype"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func (a *App) download(ctx context.Context, address string, policy executionPolicy) (io.ReadCloser, error) {
	u, err := url.Parse(address)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil { return nil, errors.New("invalid media URL") }
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, address, nil)
	if err != nil { return nil, err }
	response, err := providerHTTP(policy).Do(request)
	if err != nil { return nil, err }
	if response.StatusCode < 200 || response.StatusCode >= 300 { response.Body.Close(); return nil, errors.New("media download failed") }
	return response.Body, nil
}

func (a *App) saveGeneratedAsset(ctx context.Context, task GenerationTask, index int, source io.Reader, mimeType string, policy executionPolicy) (Asset, error) {
	id := digest("output:"+task.ID+":"+strconv.Itoa(index))
	var asset Asset
	err := a.db.First(&asset, "id = ?", id).Error
	if err == nil && asset.SaveState == "saved" { return asset, a.queueAssetSync(asset.ID) }
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) { return asset, err }
	if asset.ID == "" {
		asset = Asset{ID: id, UserID: task.UserID, Kind: task.Capability, Title: "生成成品", Path: id, SaveState: "saving", SyncState: "local", Metadata: encode(map[string]any{"source": "generation", "taskId": task.ID, "projectId": task.ProjectID, "nodeId": task.NodeID})}
		if err := a.db.Transaction(func(tx *gorm.DB) error { if err := tx.Create(&asset).Error; err != nil { return err }; return tx.Create(&TaskAsset{TaskID: task.ID, AssetID: asset.ID}).Error }); err != nil { return asset, err }
	}
	name, err := a.assetPath(id)
	if err != nil { return asset, err }
	file, err := os.OpenFile(name, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0600)
	if err != nil { return asset, err }
	limit := policy.mediaLimit(asset.Kind)
	asset.Bytes, err = io.Copy(file, io.LimitReader(source, limit+1))
	if err == nil && (asset.Bytes == 0 || asset.Bytes > limit) { err = errors.New("generated media size outside configured bounds") }
	if err == nil { err = file.Sync() }
	closeErr := file.Close()
	if err == nil { err = closeErr }
	if err != nil { a.db.Model(&asset).Updates(map[string]any{"save_state": "failed", "error": "生成原件保存失败或超过配置大小，尚未可靠保留"}); return asset, err }
	read, err := os.Open(name)
	if err != nil { return asset, err }
	detected, err := mimetype.DetectReader(read)
	read.Close()
	if err != nil { return asset, err }
	asset.MimeType, _, err = mime.ParseMediaType(detected.String())
	if asset.Kind == "audio" && mimeType == "audio/pcm" { asset.MimeType, err = mimeType, nil }
	if err != nil || !strings.HasPrefix(asset.MimeType, asset.Kind+"/") { return asset, errors.New("supplier result content type mismatch") }
	if asset.Kind == "image" {
		read, err := os.Open(name)
		if err == nil { config, _, decodeErr := image.DecodeConfig(read); read.Close(); if decodeErr == nil { asset.Width, asset.Height = config.Width, config.Height } }
	}
	a.probeMedia(ctx, &asset, policy)
	err = a.db.Model(&asset).Updates(map[string]any{"save_state": "saved", "mime_type": asset.MimeType, "width": asset.Width, "height": asset.Height, "bytes": asset.Bytes, "duration_ms": asset.DurationMS, "fps": asset.FPS, "video_codec": asset.VideoCodec, "audio_codec": asset.AudioCodec, "probe_error": asset.ProbeError, "error": ""}).Error
	if err != nil { return asset, err }
	asset.SaveState = "saved"
	if err := a.queueAssetSync(asset.ID); err != nil { return asset, err }
	return asset, nil
}

func (a *App) saveTaskResults(ctx context.Context, task GenerationTask, snapshot executionSnapshot) {
	release, err := a.acquireFile(ctx, false, true); if err != nil { return }; defer release()
	a.assetFiles.RLock(); defer a.assetFiles.RUnlock()
	ctx, cancel := context.WithTimeout(ctx, seconds(snapshot.Policy.TransferSeconds))
	defer cancel()
	var result providerResult
	if json.Unmarshal(task.Result, &result) != nil { a.taskProblem(task, "confirmation_required", "供应商结果记录无法读取，不能重新生成", false); return }
	if task.Capability != "text" && includes([]string{"failed", "cancelled", "confirmation_required"}, result.Status) && result.URL == "" && result.ResponseFile == "" {
		usageState := result.UsageState; if usageState == "" { usageState = "actual" }; usageState = normalizedUsageState(usageState); if result.Status == "confirmation_required" { usageState = "unknown" }
		if len(result.Usage) == 0 { usageState = "unknown" }
		startedAt := time.Now(); if task.StartedAt != nil { startedAt = *task.StartedAt }
		if err := a.recordUsage("task:"+task.ID, task, "", startedAt, result.Usage, snapshot, usageState); err != nil { a.taskSaveFailed(task, snapshot, err); return }
		if err := a.db.Model(&task).Updates(map[string]any{"usage_state": usageState, "save_state": "", "sync_state": ""}).Error; err != nil { a.taskSaveFailed(task, snapshot, err); return }
		a.taskProblem(task, result.Status, result.Error, result.Status != "confirmation_required"); return
	}
	ids := []string{}
	if task.Capability != "text" {
		save := func(output map[string]any) error {
			var source io.ReadCloser; var err error
			if address := text(output["url"]); address != "" { source, err = a.download(ctx, address, snapshot.Policy) } else if data := text(output["b64_json"]); data != "" { source = io.NopCloser(base64.NewDecoder(base64.StdEncoding, strings.NewReader(data))) } else { err = errors.New("missing media result") }
			if err != nil { return err }; defer source.Close()
			asset, err := a.saveGeneratedAsset(ctx, task, len(ids), source, result.MimeType, snapshot.Policy)
			if err == nil { ids = append(ids, asset.ID) }; return err
		}
		if result.URL != "" { if err := save(map[string]any{"url": result.URL}); err != nil { a.taskSaveFailed(task, snapshot, err); return } }
		if result.ResponseFile != "" {
			if result.ResponseFile != task.ID+".json" && result.ResponseFile != task.ID+".media" { a.taskProblem(task, "confirmation_required", "结果文件标识无效", false); return }
			name := filepath.Join(a.root, "results", result.ResponseFile)
			if strings.HasSuffix(result.ResponseFile, ".media") {
				file, err := os.Open(name)
				if err != nil { a.taskSaveFailed(task, snapshot, err); return }
				asset, err := a.saveGeneratedAsset(ctx, task, 0, file, result.MimeType, snapshot.Policy)
				file.Close()
				if err != nil { a.taskSaveFailed(task, snapshot, err); return }; ids = append(ids, asset.ID)
			} else {
				file, err := os.Open(name)
				if err != nil { a.taskSaveFailed(task, snapshot, err); return }
				usage, decodeErr := readImageResults(file, save); file.Close(); err = decodeErr
				if err != nil { a.taskSaveFailed(task, snapshot, err); return }
				if len(usage) > 0 {
					requests := result.Usage["requests"]
					result.Usage = usage
					if requests != nil { result.Usage["requests"] = requests }
				}
			}
		}
		if len(ids) == 0 { a.taskProblem(task, "confirmation_required", "供应商没有提供可保存成品，未重新生成", false); return }
	}
	if result.Usage == nil { result.Usage = map[string]any{} }
	usageState := result.UsageState; if usageState == "" { usageState = "actual" }; usageState = normalizedUsageState(usageState)
	if task.Capability == "image" { result.Usage["images"] = len(ids) }
	if task.Capability == "video" && result.Usage["seconds"] == nil {
		duration := int64(0); known := len(ids) > 0
		for _, id := range ids { var asset Asset; if a.db.First(&asset, "id = ?", id).Error != nil || asset.DurationMS <= 0 { known = false; break }; duration += asset.DurationMS }
		if known { result.Usage["seconds"] = new(big.Rat).SetFrac(big.NewInt(duration), big.NewInt(1000)).FloatString(3) } else { var input generationInput; _ = json.Unmarshal(task.Input, &input); var p map[string]any; _ = json.Unmarshal(input.Parameters, &p); value := p["seconds"]; if value == nil { value = p["duration"] }; if value != nil { result.Usage["seconds"] = value; usageState = "estimated" } }
	}
	if len(result.Usage) == 0 { usageState = "unknown" }
	startedAt := time.Now(); if task.StartedAt != nil { startedAt = *task.StartedAt }
	if err := a.recordUsage("task:"+task.ID, task, "", startedAt, result.Usage, snapshot, usageState); err != nil { a.taskSaveFailed(task, snapshot, err); return }
	status := "succeeded"; if result.Status == "incomplete" { status = "failed" } else if includes([]string{"failed", "cancelled", "confirmation_required"}, result.Status) { status = result.Status }
	if status != "succeeded" { task.Status, task.Error = status, result.Error }
	if status != "confirmation_required" && !task.Applied { if err := a.applyTaskResult(task, ids, result.Text); err != nil { a.taskSaveFailed(task, snapshot, err); return } }
	err = a.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&GenerationTask{}).Where("id = ?", task.ID).Updates(map[string]any{"status": status, "text": result.Text, "asset_ids": encode(ids), "save_state": "saved", "sync_state": "local", "usage_state": usageState, "response_cleanup_pending": terminalTask(status), "next_run_at": nil, "error": result.Error}).Error; err != nil { return err }
		if terminalTask(status) { return tx.Model(&TaskAsset{}).Where("task_id = ?", task.ID).Update("released", true).Error }; return nil
	})
	if err != nil { return }
	a.logEvent(ctx, slog.LevelInfo, "task.finished", slog.String("task_id", task.ID), slog.String("status", status), slog.Int("assets", len(ids)), slog.String("usage_state", usageState))
	if len(ids) > 0 { a.refreshTaskSync(ids[0]) }
	a.notify(task.UserID); a.signalWork()
}

// Only completed task responses are removed; durable asset originals remain authoritative.
func (a *App) cleanupTaskResponses(task GenerationTask) {
	if !terminalTask(task.Status) { return }
	if _, err := a.assetPath(task.ID); err != nil { return }
	var failure error
	for _, suffix := range []string{".json", ".media", ".script.json", ".pending", ".json.pending", ".media.pending"} { if err := os.Remove(filepath.Join(a.root, "results", task.ID+suffix)); err != nil && !errors.Is(err, os.ErrNotExist) { failure = err; break } }
	values := map[string]any{"response_cleanup_pending": false, "response_cleanup_error": "", "raw_response_file": "", "next_run_at": nil}
	if failure != nil {
		var snapshot executionSnapshot; if json.Unmarshal(task.Snapshot, &snapshot) != nil || len(snapshot.Policy.StorageRetrySeconds) == 0 { return }
		index := task.ResponseCleanupAttempts; if index >= len(snapshot.Policy.StorageRetrySeconds) { index = len(snapshot.Policy.StorageRetrySeconds)-1 }
		values = map[string]any{"response_cleanup_pending": true, "response_cleanup_error": "已保存成品，但供应商响应副本仍待清理，后台会继续处理", "response_cleanup_attempts": task.ResponseCleanupAttempts+1, "next_run_at": time.Now().Add(seconds(snapshot.Policy.StorageRetrySeconds[index]))}
	} else { var result providerResult; if json.Unmarshal(task.Result, &result) == nil { result.URL, result.ResponseFile = "", ""; values["result"] = encode(result) } }
	if a.db.Model(&GenerationTask{}).Where("id = ?", task.ID).Updates(values).Error == nil { a.notifyTopic(task.UserID, "tasks"); if failure == nil { a.signalWork() } }
}

// Decode one image at a time; a multi-image base64 response is never materialized in full.
func readImageResults(reader io.Reader, save func(map[string]any) error) (map[string]any, error) {
	decoder := json.NewDecoder(reader)
	token, err := decoder.Token(); if err != nil || token != json.Delim('{') { return nil, errors.New("invalid image response") }
	usage := map[string]any{}
	for decoder.More() {
		key, err := decoder.Token(); if err != nil { return nil, err }
		switch key {
		case "data":
			token, err := decoder.Token(); if err != nil || token != json.Delim('[') { return nil, errors.New("missing image data") }
			for decoder.More() { var output map[string]any; if err := decoder.Decode(&output); err != nil { return nil, err }; if err := save(output); err != nil { return nil, err } }
			if _, err := decoder.Token(); err != nil { return nil, err }
		case "usage": if err := decoder.Decode(&usage); err != nil { return nil, err }
		default: var ignored json.RawMessage; if err := decoder.Decode(&ignored); err != nil { return nil, err }
		}
	}
	_, err = decoder.Token(); return usage, err
}

func (a *App) applyTaskResult(task GenerationTask, ids []string, content string) error {
	err := a.db.Transaction(func(tx *gorm.DB) error { return a.applyTaskResultTx(tx, task, ids, content) })
	if err == nil { return nil }
	var p *Problem
	if errors.As(err, &p) { return a.db.Model(&GenerationTask{}).Where("id = ?", task.ID).Update("apply_error", p.Message).Error }
	return err
}

func (a *App) applyTaskResultTx(tx *gorm.DB, task GenerationTask, ids []string, content string) error {
	if task.ProjectID == "" || task.NodeID == "" { return nil }
	var current GenerationTask
	if err := tx.First(&current, "id = ?", task.ID).Error; err != nil { return err }; if current.Applied { return nil }
	var project Project
	if err := tx.First(&project, "id = ? AND user_id = ?", task.ProjectID, task.UserID).Error; err != nil { if errors.Is(err, gorm.ErrRecordNotFound) { return problem(409, "target_missing", "目标项目已删除，成品保留在任务与资产库") }; return err }
	document := map[string]any{}
	if err := json.Unmarshal(project.Document, &document); err != nil { return err }
	var input generationInput
	if err := json.Unmarshal(task.Input, &input); err != nil { return err }
	var snapshot executionSnapshot; if err := json.Unmarshal(task.Snapshot, &snapshot); err != nil { return err }
	var parameters map[string]any; if err := json.Unmarshal(input.Parameters, &parameters); err != nil { return err }
	var controls []parameterControl; if err := json.Unmarshal(snapshot.Model.Parameters, &controls); err != nil { return err }
	for _, control := range controls { if id, ok := parameters[control.Key].(string); ok && control.Type == "asset" && id != "" { parameters[control.Key] = "asset:"+id } }
	if !onlyTaskUpdates(tx, project.ID, input.BatchID, task.ProjectVersion, project.Version) { return problem(409, "version_conflict", "项目在提交后已被编辑，未覆盖；成品保留在资产库和任务记录") }
	found := false
	for _, raw := range array(document["nodes"]) {
		node := object(raw)
		if node["id"] != task.NodeID { continue }
		found = true
		metadata := object(node["metadata"])
		model := task.ChannelID+"::"+snapshot.Model.Model
		modelParameters := object(metadata["modelParameters"]); modelParameters[model] = parameters
		metadata["model"], metadata["modelParameters"], metadata["generationMode"] = model, modelParameters, task.Capability
		if input.Prompt != "" { metadata["prompt"] = input.Prompt }
		status, message := "success", ""
		if task.Status == "failed" || task.Status == "cancelled" || task.Status == "interrupted" { status, message = "error", task.Error }
		metadata["status"], metadata["errorDetails"] = status, message
		if task.Capability == "text" {
			if input.ResultSlotID == "" { metadata["content"] = content; delete(metadata, "texts"); delete(metadata, "primaryTextId")
			} else {
				slots := array(metadata["texts"]); slotFound := false
				for _, raw := range slots { slot := object(raw); if slot["id"] == input.ResultSlotID { slot["content"], slot["status"], slot["errorDetails"] = content, status, message; slotFound = true } }
				if !slotFound { return problem(409, "result_slot_missing", "目标文本位置已被移除，成品仍保留在任务中") }
				if text(metadata["primaryTextId"]) == "" || metadata["primaryTextId"] == input.ResultSlotID { metadata["content"], metadata["primaryTextId"] = content, input.ResultSlotID }
			}
		} else if status == "error" && input.ResultSlotID != "" && len(ids) == 0 {
			for _, raw := range array(metadata["images"]) { slot := object(raw); if slot["id"] == input.ResultSlotID { slot["status"], slot["errorDetails"] = status, message } }
		} else if len(ids) > 0 {
			images := []map[string]any{}; var asset Asset
			for index, id := range ids {
				var saved Asset
				if err := tx.First(&saved, "id = ? AND delete_state = ?", id, "").Error; err != nil { if errors.Is(err, gorm.ErrRecordNotFound) { return problem(409, "result_asset_deleted", "成品资产已申请删除，未新增画布引用；任务结果与用量仍保留") }; return err }
				if index == 0 { asset = saved }
				images = append(images, map[string]any{"id": id, "status": status, "errorDetails": message, "content": "/api/assets/"+id+"/file", "storageKey": "asset:"+id, "naturalWidth": saved.Width, "naturalHeight": saved.Height, "durationMs": saved.DurationMS, "bytes": saved.Bytes, "mimeType": saved.MimeType})
			}
			media := images[0]
			primary := true
			if task.Capability == "image" && input.ResultSlotID != "" {
				slots, combined, slotFound := array(metadata["images"]), []any{}, false
				for _, raw := range slots { if object(raw)["id"] == input.ResultSlotID { media["id"] = input.ResultSlotID; for _, image := range images { combined = append(combined, image) }; slotFound = true } else { combined = append(combined, raw) } }
				if !slotFound { return problem(409, "result_slot_missing", "目标图片位置已被移除，成品仍保留在资产库") }
				metadata["images"] = combined
				primary = text(metadata["primaryImageId"]) == "" || metadata["primaryImageId"] == input.ResultSlotID
				if primary { metadata["primaryImageId"] = input.ResultSlotID }
			} else if task.Capability == "image" {
				metadata["images"], metadata["primaryImageId"] = images, ids[0]
			}
			if primary {
				for key, value := range media { if key != "id" { metadata[key] = value } }
				if (asset.Kind == "image" || asset.Kind == "video") && asset.Width > 0 && asset.Height > 0 && metadata["freeResize"] != true {
					width, _ := node["width"].(float64); height, _ := node["height"].(float64)
					ratio := float64(asset.Width)/float64(asset.Height)
					if width/height > ratio { width = height*ratio } else { height = width/ratio }
					position := object(node["position"]); x, _ := position["x"].(float64); y, _ := position["y"].(float64)
					position["x"], position["y"] = x+(node["width"].(float64)-width)/2, y+(node["height"].(float64)-height)/2
					node["width"], node["height"] = width, height
				}
			}
		}
		if input.ResultSlotID != "" { key := "images"; if task.Capability == "text" { key = "texts" }; for _, raw := range array(metadata[key]) { if object(raw)["status"] == "loading" { metadata["status"] = "loading"; break } } }
		node["metadata"] = metadata
	}
	if !found { return problem(409, "target_missing", "目标节点已移除，成品保留在任务与资产库") }
	data := encode(document)
	refs, err := validateDocument(data); if err != nil { return err }
	if err := checkAssets(tx, task.UserID, refs); err != nil { return err }
	result := tx.Model(&Project{}).Where("id = ? AND version = ?", project.ID, project.Version).Updates(map[string]any{"document": data, "version": project.Version+1, "updated_at": time.Now()})
	if result.Error != nil { return result.Error }; if result.RowsAffected != 1 { return problem(409, "version_conflict", "项目已更新，成品未覆盖编辑") }
	if err := replaceReferences(tx, project.ID, refs); err != nil { return err }
	return tx.Model(&GenerationTask{}).Where("id = ?", task.ID).Updates(map[string]any{"applied": true, "applied_version": project.Version+1, "apply_error": ""}).Error
}

// Only result writes can advance a submitted version without invalidating its sibling tasks.
func onlyTaskUpdates(tx *gorm.DB, projectID, batchID string, before, after uint64) bool {
	if before > after { return false }; if before == after { return true }
	var count int64
	return tx.Model(&GenerationTask{}).Where("project_id = ? AND applied = ? AND applied_version > ? AND applied_version <= ? AND json_extract(input, '$.batchId') = ?", projectID, true, before, after, batchID).Count(&count).Error == nil && uint64(count) == after-before
}

func (a *App) taskProjectVersion(c *gin.Context) {
	var input struct { Version uint64 `json:"version"` }
	if !bind(c, &input) { return }
	var task GenerationTask
	if err := a.db.First(&task, "id = ? AND user_id = ? AND applied = ?", c.Param("id"), currentUser(c).ID, true).Error; err != nil { respondError(c, err); return }
	var project Project
	var submitted generationInput
	if json.Unmarshal(task.Input, &submitted) != nil { respondError(c, problem(409, "invalid_task", "任务提交内容无法读取")); return }
	err := a.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.First(&project, "id = ? AND user_id = ?", task.ProjectID, task.UserID).Error; err != nil { return err }
		if input.Version < task.ProjectVersion || !onlyTaskUpdates(tx, project.ID, submitted.BatchID, input.Version, project.Version) { return problem(409, "version_conflict", "项目包含其他页面或工具的编辑，请保留本地内容并重新读取") }
		return nil
	})
	if err != nil { respondError(c, err); return }; c.JSON(200, gin.H{"project": project, "targetNode": task.TargetNode, "resultSlotId": submitted.ResultSlotID})
}

