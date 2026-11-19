package app

import (
	"encoding/json"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type projectInput struct {
	ID string `json:"id"`
	Title string `json:"title"`
	Version uint64 `json:"version"`
	OperationID string `json:"operationId,omitempty"`
	Document JSON `json:"document"`
	RevertsVersion uint64 `json:"-"`
	ExpectedVersion uint64 `json:"-"`
}

func (a *App) ListProjects(userID string, allowed []string) ([]Project, error) {
	projects := []Project{}
	query := a.db.Where("user_id = ?", userID)
	if len(allowed) > 0 { query = query.Where("id IN ?", allowed) }
	err := query.Order("updated_at DESC").Find(&projects).Error
	return projects, err
}

func (a *App) listProjects(c *gin.Context) {
	projects, err := a.ListProjects(currentUser(c).ID, nil)
	if err != nil { respondError(c, err); return }
	c.JSON(200, projects)
}

func (a *App) GetProject(userID, id string) (Project, error) {
	var project Project
	err := a.db.First(&project, "id = ? AND user_id = ?", id, userID).Error
	return project, err
}

func (a *App) getProject(c *gin.Context) {
	project, err := a.GetProject(currentUser(c).ID, c.Param("id"))
	if err != nil { respondError(c, err); return }
	c.JSON(200, project)
}

// Project mutations are also the service boundary for future assistant and MCP adapters.
func (a *App) CreateProject(userID string, input projectInput) (Project, error) {
	project := Project{ID: identifier(), UserID: userID, Title: strings.TrimSpace(input.Title), Version: 1, Document: input.Document}
	if err := validTitle(project.Title); err != nil { return project, err }
	refs, err := validateDocument(input.Document)
	if err != nil { return project, err }
	err = a.db.Transaction(func(tx *gorm.DB) error {
		if err := checkAssets(tx, userID, refs); err != nil { return err }
		deleted := []Asset{}
		if len(refs) > 0 { if err := tx.Where("id IN ? AND delete_state <> ?", refs, "").Find(&deleted).Error; err != nil { return err } }
		if len(deleted) > 0 {
			project.Document, err = deletedAssetPlaceholders(project.Document, deleted)
			if err != nil { return err }
			refs, err = validateDocument(project.Document)
			if err != nil { return err }
		}
		if err := tx.Create(&project).Error; err != nil { return err }
		if err := recordProjectRevision(tx, project); err != nil { return err }
		return replaceReferences(tx, project.ID, refs)
	})
	if err == nil { a.notify(userID) }
	return project, err
}

func (a *App) createProject(c *gin.Context) {
	var input projectInput
	if !bind(c, &input) { return }
	project, err := a.CreateProject(currentUser(c).ID, input)
	if err != nil { respondError(c, err); return }
	c.JSON(201, project)
}

func (a *App) SaveProject(userID, id string, input projectInput) (Project, error) {
	project := Project{}
	if err := validTitle(input.Title); err != nil { return project, err }
	refs, err := validateDocument(input.Document)
	if err != nil { return project, err }
	err = a.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.First(&project, "id = ? AND user_id = ?", id, userID).Error; err != nil { return err }
		if input.RevertsVersion != 0 && input.ExpectedVersion != project.Version { return problem(409, "version_conflict", "画布已更新，请同步后重试撤销") }
		if err := recordProjectRevision(tx, project); err != nil { return err }
		if input.Version != project.Version {
			var base ProjectRevision
			if err := tx.First(&base, "project_id = ? AND version = ?", id, input.Version).Error; err != nil { return problem(409, "version_conflict", "缺少原始画布版本，未保存内容已保留，请核对后重试") }
			merged, err := mergeProject(Project{Title: base.Title, Document: base.Document}, Project{Title: input.Title, Document: input.Document}, project)
			if err != nil { return err }
			input.Title, input.Document = merged.Title, merged.Document
		}
		refs, err = validateDocument(input.Document); if err != nil { return err }
		if err := checkAssets(tx, userID, refs); err != nil { return err }
		result := tx.Model(&Project{}).Where("id = ? AND user_id = ? AND version = ?", id, userID, project.Version).Updates(map[string]any{
			"title": strings.TrimSpace(input.Title), "document": input.Document, "version": project.Version + 1, "updated_at": time.Now(),
		})
		if result.Error != nil { return result.Error }
		if result.RowsAffected != 1 { return problem(409, "version_conflict", "项目已更新，未保存内容已保留") }
		if err := replaceReferences(tx, id, refs); err != nil { return err }
		if err := tx.First(&project, "id = ?", id).Error; err != nil { return err }
		return recordProjectRevision(tx, project, input)
	})
	if err == nil { a.notify(userID) }
	return project, err
}

func (a *App) saveProject(c *gin.Context) {
	var input projectInput
	if !bind(c, &input) { return }
	project, err := a.SaveProject(currentUser(c).ID, c.Param("id"), input)
	if err != nil { respondError(c, err); return }
	c.JSON(200, project)
}

func validateDocument(document JSON) ([]string, error) {
	var data map[string]any
	if err := json.Unmarshal(document, &data); err != nil || data == nil { return nil, problem(400, "invalid_document", "画布内容必须是对象") }
	nodes, nodesOK := data["nodes"].([]any)
	connections, connectionsOK := data["connections"].([]any)
	if !nodesOK || !connectionsOK { return nil, problem(400, "invalid_document", "画布需要节点和连线数组") }
	ids := map[string]bool{}
	for _, item := range nodes {
		node, ok := item.(map[string]any)
		if !ok { return nil, problem(400, "invalid_node", "节点结构不正确") }
		id, _ := node["id"].(string)
		kind, _ := node["type"].(string)
		position, _ := node["position"].(map[string]any)
		_, xOK := position["x"].(float64)
		_, yOK := position["y"].(float64)
		width, wOK := node["width"].(float64)
		height, hOK := node["height"].(float64)
		if id == "" || kind == "" || ids[id] || !xOK || !yOK || !wOK || !hOK || width <= 0 || height <= 0 { return nil, problem(400, "invalid_node", "节点编号、类型、位置或尺寸不正确") }
		ids[id] = true
	}
	connectionIDs := map[string]bool{}
	for _, item := range connections {
		connection, ok := item.(map[string]any)
		if !ok { return nil, problem(400, "invalid_connection", "连线结构不正确") }
		id, _ := connection["id"].(string)
		from, _ := connection["fromNodeId"].(string)
		to, _ := connection["toNodeId"].(string)
		if id == "" || connectionIDs[id] || !ids[from] || !ids[to] { return nil, problem(400, "invalid_connection", "连线编号或节点引用不正确") }
		connectionIDs[id] = true
	}
	for _, item := range nodes {
		node := item.(map[string]any)
		if node["type"] != "image" && node["type"] != "video" && node["type"] != "audio" { continue }
		metadata, _ := node["metadata"].(map[string]any)
		content, _ := metadata["content"].(string)
		if content != "" && !strings.HasPrefix(content, "/api/assets/") && !strings.HasPrefix(content, "deleted-asset:") { return nil, problem(400, "unsaved_media", "节点媒体需要先保存到服务端资产库") }
	}
	return collectAssetReferences(data)
}

func collectAssetReferences(data any) ([]string, error) {
	refs := map[string]bool{}
	var walk func(any, string) error
	walk = func(value any, key string) error {
		switch v := value.(type) {
		case map[string]any:
			for k, child := range v {
				// Text bodies and prompts may contain URL examples; only explicit media fields are references.
				if includes([]string{"title", "prompt", "composerContent", "text", "instructions", "systemPrompt", "errorDetails"}, k) { continue }
				if _, ok := child.(string); k == "content" && ok { continue }
				if err := walk(child, k); err != nil { return err }
			}
			if content, ok := v["content"].(string); ok && (strings.HasPrefix(content, "/api/assets/") || strings.HasPrefix(content, "asset:") || v["storageKey"] != nil || v["mimeType"] != nil) { if err := walk(content, "url"); err != nil { return err } }
		case []any:
			for _, child := range v { if err := walk(child, key); err != nil { return err } }
		case string:
			if strings.HasPrefix(v, "deleted-asset:") { return nil }
			if strings.HasPrefix(v, "/api/assets/") {
				parsed, err := url.Parse(v)
				if err != nil { return problem(400, "invalid_asset_reference", "资产地址不正确") }
				parts := strings.Split(strings.TrimPrefix(parsed.Path, "/api/assets/"), "/")
				if len(parts) != 2 || parts[0] == "" || (parts[1] != "file" && parts[1] != "preview") || parsed.RawQuery != "" || parsed.Fragment != "" { return problem(400, "invalid_asset_reference", "资产需要稳定文件地址") }
				refs[parts[0]] = true
			}
			if strings.HasPrefix(v, "asset:") { refs[strings.TrimPrefix(v, "asset:")] = true }
			if key == "storageKey" && v != "" {
				if !strings.HasPrefix(v, "asset:") { return problem(400, "invalid_asset_reference", "媒体需要先保存到服务端资产库") }
				refs[strings.TrimPrefix(v, "asset:")] = true
			}
			if key == "assetId" && v != "" { refs[v] = true }
			if key == "url" || key == "dataUrl" || key == "previewUrl" || key == "coverUrl" {
				if strings.HasPrefix(v, "blob:") || strings.HasPrefix(v, "data:") { return problem(400, "unsaved_media", "媒体尚未保存，不能使用临时文件地址保存项目") }
				if strings.HasPrefix(v, "https://") || strings.HasPrefix(v, "http://") { return problem(400, "external_media", "请先将外部媒体保存到资产库") }
			}
		}
		return nil
	}
	if err := walk(data, ""); err != nil { return nil, err }
	result := make([]string, 0, len(refs))
	for id := range refs { result = append(result, id) }
	return result, nil
}

// A copied project retains deleted media as inert placeholders, never new usable asset references.
func deletedAssetPlaceholders(document JSON, assets []Asset) (JSON, error) {
	deleted := map[string]bool{}
	for _, asset := range assets { deleted[asset.ID] = true }
	var value any
	if err := json.Unmarshal(document, &value); err != nil { return nil, err }
	var walk func(any, string) any
	walk = func(value any, key string) any {
		switch item := value.(type) {
		case map[string]any:
			for name, child := range item {
				if includes([]string{"title", "prompt", "composerContent", "text", "instructions", "systemPrompt", "errorDetails"}, name) { continue }
				item[name] = walk(child, name)
			}
		case []any:
			for index, child := range item { item[index] = walk(child, key) }
		case string:
			id := ""
			if strings.HasPrefix(item, "asset:") { id = strings.TrimPrefix(item, "asset:") }
			if strings.HasPrefix(item, "/api/assets/") { id = strings.Split(strings.TrimPrefix(item, "/api/assets/"), "/")[0] }
			if key == "assetId" { id = item }
			if deleted[id] { return "deleted-asset:" + id }
		}
		return value
	}
	return json.Marshal(walk(value, ""))
}

func checkAssets(tx *gorm.DB, userID string, ids []string) error {
	for _, id := range ids {
		var asset Asset
		if err := tx.First(&asset, "id = ? AND user_id = ?", id, userID).Error; err != nil { return problem(400, "invalid_asset_reference", "引用的资产不存在或无权访问") }
		if asset.SaveState != "saved" && asset.DeleteState == "" { return problem(409, "asset_not_saved", "引用的资产尚未可靠保存") }
		// Existing deleted placeholders remain valid; creating new references is checked below.
	}
	return nil
}

func replaceReferences(tx *gorm.DB, projectID string, ids []string) error {
	for _, id := range ids {
		var asset Asset
		if err := tx.First(&asset, "id = ?", id).Error; err != nil { return err }
		if asset.DeleteState != "" {
			var count int64
			if err := tx.Model(&AssetReference{}).Where("project_id = ? AND asset_id = ?", projectID, id).Count(&count).Error; err != nil { return err }
			if count == 0 { return problem(409, "asset_deleted", "资产已删除，不能新增引用") }
		}
	}
	if err := tx.Delete(&AssetReference{}, "project_id = ?", projectID).Error; err != nil { return err }
	for _, id := range ids { if err := tx.Create(&AssetReference{ProjectID: projectID, AssetID: id}).Error; err != nil { return err } }
	return nil
}
