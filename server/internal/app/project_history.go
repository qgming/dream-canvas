package app

import (
	"encoding/json"
	"sort"
	"reflect"
	"time"

	jsonpatch "github.com/evanphx/json-patch/v5"
	"github.com/gin-gonic/gin"
	"github.com/wI2L/jsondiff"
	"gorm.io/gorm"
)

// History is shared by webpage, assistant, MCP and generated results; no media bytes are copied.
type ProjectRevision struct {
	ProjectID string `gorm:"primaryKey"`
	Version uint64 `gorm:"primaryKey"`
	Title string
	Document JSON `gorm:"type:blob"`
	RevertsVersion uint64
	OperationID string
	Undoable bool
	CreatedAt time.Time
}

func recordProjectRevision(tx *gorm.DB, project Project, operations ...projectInput) error {
	revision := ProjectRevision{ProjectID: project.ID, Version: project.Version, Title: project.Title, Document: project.Document}
	var previous ProjectRevision
	if err := tx.First(&previous, "project_id = ? AND version = ?", project.ID, project.Version-1).Error; err == nil {
		before, after := map[string]any{}, map[string]any{}
		if err := json.Unmarshal(previous.Document, &before); err != nil { return err }; if err := json.Unmarshal(project.Document, &after); err != nil { return err }
		delete(before, "viewport"); delete(after, "viewport")
		revision.Undoable = previous.Title != project.Title || !jsonpatch.Equal(encode(before), encode(after))
	} else if err != gorm.ErrRecordNotFound { return err }
	if len(operations) > 0 { revision.RevertsVersion, revision.OperationID = operations[0].RevertsVersion, operations[0].OperationID }
	if revision.RevertsVersion != 0 { revision.Undoable = true }
	return tx.FirstOrCreate(&ProjectRevision{ProjectID: project.ID, Version: project.Version}, revision).Error
}

const canvasRows, canvasOrder = "$canvasRows", "$canvasOrder"

func normalizeCanvas(value any) any {
	switch value := value.(type) {
	case []any:
		rows, order := map[string]any{}, []any{}
		for _, raw := range value { item, ok := raw.(map[string]any); if !ok || text(item["id"]) == "" { result := []any{}; for _, item := range value { result = append(result, normalizeCanvas(item)) }; return result }; id := text(item["id"]); rows[id], order = normalizeCanvas(item), append(order, id) }
		return map[string]any{canvasRows: rows, canvasOrder: string(encode(order))}
	case map[string]any:
		result := map[string]any{}; for key, item := range value { result[key] = normalizeCanvas(item) }; return result
	default: return value
	}
}

func denormalizeCanvas(value any) any {
	switch value := value.(type) {
	case []any:
		result := []any{}; for _, item := range value { result = append(result, denormalizeCanvas(item)) }; return result
	case map[string]any:
		if rows, ok := value[canvasRows].(map[string]any); ok {
			result, used := []any{}, map[string]bool{}
			var order []string; _ = json.Unmarshal([]byte(text(value[canvasOrder])), &order)
			for _, id := range order { if item, ok := rows[id]; ok && !used[id] { result = append(result, denormalizeCanvas(item)); used[id] = true } }
			remaining := []string{}; for id := range rows { if !used[id] { remaining = append(remaining, id) } }; sort.Strings(remaining)
			for _, id := range remaining { result = append(result, denormalizeCanvas(rows[id])) }; return result
		}
		result := map[string]any{}; for key, item := range value { result[key] = denormalizeCanvas(item) }; return result
	default: return value
	}
}

func projectContent(project Project) ([]byte, error) {
	var document map[string]any
	if err := json.Unmarshal(project.Document, &document); err != nil { return nil, err }
	return json.Marshal(normalizeCanvas(map[string]any{"title": project.Title, "document": document}))
}

func applyCanvasChanges(current []byte, changes jsondiff.Patch) ([]byte, error) {
	patch, err := jsonpatch.DecodePatch(encode(changes)); if err != nil { return nil, err }
	return patch.Apply(current)
}

// Changed fields win at commit time; untouched fields always come from the latest document.
func mergeProject(base, edited, current Project) (Project, error) {
	var baseDocument, editedDocument, currentDocument map[string]any
	if err := json.Unmarshal(base.Document, &baseDocument); err != nil { return current, err }
	if err := json.Unmarshal(edited.Document, &editedDocument); err != nil { return current, err }
	if err := json.Unmarshal(current.Document, &currentDocument); err != nil { return current, err }
	find := func(document map[string]any, id string) map[string]any { for _, raw := range array(document["nodes"]) { node := object(raw); if node["id"] == id { return node } }; return nil }
	for _, raw := range array(editedDocument["nodes"]) {
		node := object(raw); beforeNode, latestNode := find(baseDocument, text(node["id"])), find(currentDocument, text(node["id"])); if beforeNode == nil || latestNode == nil { continue }
		metadata, original, latest := object(node["metadata"]), object(beforeNode["metadata"]), object(latestNode["metadata"])
		if original["status"] != "loading" { continue }
		completed := false
		for _, key := range []string{"images", "texts"} {
			for _, raw := range array(metadata[key]) {
				slot := object(raw); if slot["status"] != "loading" { continue }
				var saved, previous map[string]any
				for _, raw := range array(latest[key]) { if item := object(raw); item["id"] == slot["id"] { saved = item } }
				for _, raw := range array(original[key]) { if item := object(raw); item["id"] == slot["id"] { previous = item } }
				if saved == nil || saved["status"] == "loading" || reflect.DeepEqual(saved, previous) { continue }
				for key := range slot { delete(slot, key) }; for key, value := range saved { slot[key] = value }; completed = true
			}
		}
		if completed || metadata["status"] == "loading" && latest["status"] != "loading" && (!reflect.DeepEqual(latest["content"], original["content"]) || !reflect.DeepEqual(latest["storageKey"], original["storageKey"])) {
			for _, key := range []string{"content", "storageKey", "status", "errorDetails", "naturalWidth", "naturalHeight", "bytes", "mimeType", "durationMs", "primaryImageId", "primaryTextId"} { if value, ok := latest[key]; ok { metadata[key] = value } else { delete(metadata, key) } }
		}
		node["metadata"] = metadata
	}
	edited.Document = encode(editedDocument)
	before, err := projectContent(base); if err != nil { return current, err }
	after, err := projectContent(edited); if err != nil { return current, err }
	latest, err := projectContent(current); if err != nil { return current, err }
	changes, err := jsondiff.CompareJSON(before, after); if err != nil { return current, err }
	merged, err := applyCanvasChanges(latest, changes)
	if err != nil { return current, problem(409, "version_conflict", "修改目标已被删除或结构已变化，未保存内容已保留，请核对后重试") }
	var value any; if err := json.Unmarshal(merged, &value); err != nil { return current, err }
	content := object(denormalizeCanvas(value)); document := object(content["document"])
	ids := map[string]bool{}; for _, raw := range array(document["nodes"]) { ids[text(object(raw)["id"])] = true }
	connections := []any{}; for _, raw := range array(document["connections"]) { connection := object(raw); if ids[text(connection["fromNodeId"])] && ids[text(connection["toNodeId"])] { connections = append(connections, raw) } }; document["connections"] = connections
	current.Title, current.Document = text(content["title"]), encode(document)
	return current, nil
}

func (a *App) projectHistory(c *gin.Context) {
	project, err := a.GetProject(currentUser(c).ID, c.Param("id")); if err != nil { respondError(c, err); return }
	history, err := a.ProjectHistory(project); if err != nil { respondError(c, err); return }; c.JSON(200, history)
}

type canvasHistory struct { Past []uint64 `json:"past"`; Future []uint64 `json:"future"`; Head uint64 `json:"head"` }
func (a *App) ProjectHistory(project Project) (canvasHistory, error) {
	history := canvasHistory{Past: []uint64{}, Future: []uint64{}, Head: project.Version}
	type operation struct { Version uint64; RevertsVersion uint64; Undoable bool; OperationID string }
	rows := []operation{}; var previous operation
	if err := a.db.Model(&ProjectRevision{}).Select("version, reverts_version, undoable, operation_id").Where("project_id = ? AND version <= ?", project.ID, project.Version).Order("version").Find(&rows).Error; err != nil { return history, err }
	for _, row := range rows {
		prior := previous; previous = row
		if !row.Undoable { continue }
		past, future := len(history.Past), len(history.Future)
		if row.RevertsVersion == 0 && row.OperationID != "" && row.OperationID == prior.OperationID && prior.RevertsVersion == 0 && past > 0 && history.Past[past-1] == prior.Version { history.Past[past-1] = row.Version; history.Future = []uint64{}
		} else if row.RevertsVersion != 0 && past > 0 && history.Past[past-1] == row.RevertsVersion { history.Past = history.Past[:past-1]; history.Future = append(history.Future, row.Version)
		} else if row.RevertsVersion != 0 && future > 0 && history.Future[future-1] == row.RevertsVersion { history.Future = history.Future[:future-1]; history.Past = append(history.Past, row.Version)
		} else { history.Past = append(history.Past, row.Version); history.Future = []uint64{} }
	}
	return history, nil
}

// Revert one operation as a new operation; concurrent, unrelated changes remain intact.
func (a *App) revertProject(c *gin.Context) {
	var input struct { Version uint64 `json:"version"`; TargetVersion uint64 `json:"targetVersion"` }; if !bind(c, &input) { return }
	project, err := a.RevertProject(currentUser(c).ID, c.Param("id"), input.Version, input.TargetVersion)
	if err != nil { respondError(c, err); return }; c.JSON(200, project)
}

func (a *App) RevertProject(userID, id string, version, target uint64) (Project, error) {
	project, err := a.GetProject(userID, id); if err != nil { return project, err }
	if project.Version != version { return project, problem(409, "version_conflict", "画布已更新，请同步后重试撤销") }
	history, err := a.ProjectHistory(project); if err != nil { return project, err }
	if (len(history.Past) == 0 || history.Past[len(history.Past)-1] != target) && (len(history.Future) == 0 || history.Future[len(history.Future)-1] != target) { return project, problem(409, "history_changed", "撤销历史已更新，请同步后重试") }
	var before, after ProjectRevision
	if target <= 1 { return project, problem(409, "history_unavailable", "没有可撤销的修改") }
	if err := a.db.First(&before, "project_id = ? AND version = ?", id, target-1).Error; err != nil { return project, err }
	if err := a.db.First(&after, "project_id = ? AND version = ?", id, target).Error; err != nil { return project, err }
	if after.OperationID != "" {
		before = ProjectRevision{}
		if err := a.db.Where("project_id = ? AND version < ? AND (operation_id <> ? OR reverts_version <> 0)", id, target, after.OperationID).Order("version DESC").First(&before).Error; err != nil { return project, err }
	}
	var document, previous map[string]any
	if err := json.Unmarshal(before.Document, &document); err != nil { return project, err }; if err := json.Unmarshal(after.Document, &previous); err != nil { return project, err }
	if viewport, ok := previous["viewport"]; ok { document["viewport"] = viewport } else { delete(document, "viewport") }; before.Document = encode(document)
	for _, raw := range array(document["nodes"]) {
		node := object(raw); metadata := object(node["metadata"]); if metadata["status"] != "loading" { continue }
		var active int64
		if err := a.db.Model(&GenerationTask{}).Where("project_id = ? AND node_id = ? AND status NOT IN ?", id, text(node["id"]), []string{"succeeded", "failed", "cancelled", "interrupted"}).Count(&active).Error; err != nil { return project, err }
		if active == 0 { metadata["status"] = "idle" }
		for _, key := range []string{"images", "texts"} { for _, raw := range array(metadata[key]) {
			slot := object(raw); if slot["status"] != "loading" { continue }
			var pending int64
			if err := a.db.Model(&GenerationTask{}).Where("project_id = ? AND node_id = ? AND json_extract(input, '$.resultSlotId') = ? AND status NOT IN ?", id, text(node["id"]), text(slot["id"]), []string{"succeeded", "failed", "cancelled", "interrupted"}).Count(&pending).Error; err != nil { return project, err }
			if pending == 0 { slot["status"] = "idle" }
		} }
	}
	before.Document = encode(document)
	refs, err := validateDocument(before.Document); if err != nil { return project, err }
	if len(refs) > 0 { deleted := []Asset{}; if err := a.db.Where("id IN ? AND delete_state <> ?", refs, "").Find(&deleted).Error; err != nil { return project, err }; if len(deleted) > 0 { before.Document, err = deletedAssetPlaceholders(before.Document, deleted); if err != nil { return project, err } } }
	return a.SaveProject(userID, id, projectInput{Title: before.Title, Version: after.Version, Document: before.Document, RevertsVersion: target, ExpectedVersion: version})
}
