package app

import (
	"encoding/json"
	"errors"
	"path"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/evanw/esbuild/pkg/api"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type CanvasPluginRecord struct {
	ID string `json:"id" gorm:"primaryKey"`
	Name string `json:"name"`
	Description string `json:"description"`
	Builtin bool `json:"builtin"`
	Enabled bool `json:"enabled"`
	Version uint64 `json:"version"`
	PublishedVersionID string `json:"publishedVersionId"`
	Nodes JSON `json:"nodes" gorm:"type:blob"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type CanvasPluginDraft struct {
	PluginID string `json:"pluginId" gorm:"primaryKey"`
	Revision uint64 `json:"revision"`
	Files JSON `json:"files" gorm:"type:blob"`
	UpdatedBy string `json:"updatedBy"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type CanvasPluginVersion struct {
	ID string `json:"id" gorm:"primaryKey"`
	PluginID string `json:"pluginId" gorm:"index;not null"`
	Revision uint64 `json:"revision"`
	Files JSON `json:"files" gorm:"type:blob"`
	Source string `json:"-"`
	PublishedBy string `json:"publishedBy"`
	CreatedAt time.Time `json:"createdAt"`
}

type canvasNodeSpec struct {
	Type string `json:"type"`
	Title string `json:"title"`
	DefaultSize struct { Width float64 `json:"width"`; Height float64 `json:"height"` } `json:"defaultSize"`
	DefaultMetadata map[string]any `json:"defaultMetadata,omitempty"`
}

type canvasPluginManifest struct {
	SchemaVersion int `json:"schemaVersion"`
	ID string `json:"id"`
	Name string `json:"name"`
	Description string `json:"description"`
	Entry string `json:"entry"`
	Nodes []canvasNodeSpec `json:"nodes"`
}

type canvasPluginCatalogEntry struct {
	CanvasPluginRecord
	Source string `json:"source,omitempty"`
}

func (a *App) installBuiltinCanvasPlugins() error {
	definitions := []struct { ID, Name, Type string; Width, Height float64 }{
		{"builtin-text", "文本", "text", 340, 240}, {"builtin-image", "图片", "image", 340, 240},
		{"builtin-video", "视频", "video", 420, 236}, {"builtin-audio", "音频", "audio", 340, 120},
		{"builtin-config", "生成配置", "config", 340, 240}, {"builtin-group", "组", "group", 760, 480},
		{"markdown", "Markdown", "markdown:doc", 360, 300}, {"svg", "SVG", "svg:vector", 320, 320},
		{"html", "HTML", "html:render", 420, 320}, {"panorama", "3D 全景", "panorama:viewer", 480, 300},
		{"sticky-note", "便利贴", "sticky-note:note", 240, 200},
		{"upscale", "超分", canvasUpscaleNodeType, 420, 280},
	}
	for _, definition := range definitions {
		node := canvasNodeSpec{Type: definition.Type, Title: definition.Name, DefaultMetadata: map[string]any{"content": ""}}
		if strings.HasPrefix(definition.ID, "builtin-") { node.DefaultMetadata["status"] = "idle" }
		if definition.Type == canvasUpscaleNodeType { node.DefaultMetadata["status"] = "idle" }
		if definition.Type == "text" { node.DefaultMetadata["fontSize"] = 14 }
		if definition.Type == "config" { node.DefaultMetadata["generationMode"] = "image" }
		if definition.Type == "sticky-note:note" { node.DefaultMetadata["pluginColor"] = "#fde68a" }
		node.DefaultSize.Width, node.DefaultSize.Height = definition.Width, definition.Height
		record := CanvasPluginRecord{ID: definition.ID, Name: definition.Name, Builtin: true, Enabled: true, Version: 1, PublishedVersionID: "builtin", Nodes: encode([]canvasNodeSpec{node})}
		if err := a.db.Where("id = ?", record.ID).FirstOrCreate(&record).Error; err != nil { return err }
		if !record.Builtin { return errors.New("builtin canvas plugin ID is already in use") }
	}
	return nil
}

func (a *App) ListCanvasPlugins() ([]CanvasPluginRecord, error) {
	rows := []CanvasPluginRecord{}
	err := a.db.Order("builtin DESC, created_at, id").Find(&rows).Error
	return rows, err
}

func (a *App) ListCanvasNodes() ([]canvasNodeSpec, error) {
	rows := []CanvasPluginRecord{}
	if err := a.db.Where("enabled = ? AND published_version_id <> ?", true, "").Order("builtin DESC, created_at, id").Find(&rows).Error; err != nil { return nil, err }
	result := []canvasNodeSpec{}
	for _, row := range rows { var nodes []canvasNodeSpec; if err := json.Unmarshal(row.Nodes, &nodes); err != nil { return nil, err }; result = append(result, nodes...) }
	return result, nil
}

func (a *App) CanvasPluginCatalog() ([]canvasPluginCatalogEntry, error) {
	rows, err := a.ListCanvasPlugins(); if err != nil { return nil, err }
	result := make([]canvasPluginCatalogEntry, 0, len(rows))
	for _, row := range rows {
		entry := canvasPluginCatalogEntry{CanvasPluginRecord: row}
		if row.PublishedVersionID == "" { continue }
		if row.Enabled && !row.Builtin && row.PublishedVersionID != "" {
			var version CanvasPluginVersion
			if err := a.db.First(&version, "id = ? AND plugin_id = ?", row.PublishedVersionID, row.ID).Error; err != nil { return nil, err }
			entry.Source = version.Source
		}
		result = append(result, entry)
	}
	return result, nil
}

func (a *App) GetCanvasPlugin(id string) (map[string]any, error) {
	var record CanvasPluginRecord
	if err := a.db.First(&record, "id = ?", id).Error; err != nil { return nil, err }
	result := map[string]any{"plugin": record, "versions": []CanvasPluginVersion{}}
	if record.Builtin { return result, nil }
	var draft CanvasPluginDraft
	if err := a.db.First(&draft, "plugin_id = ?", id).Error; err != nil { return nil, err }
	versions := []CanvasPluginVersion{}
	if err := a.db.Where("plugin_id = ?", id).Order("created_at DESC").Find(&versions).Error; err != nil { return nil, err }
	result["draft"], result["versions"] = draft, versions
	return result, nil
}

func (a *App) CreateCanvasPlugin(user User, name, description string) (CanvasPluginRecord, error) {
	if err := validTitle(name); err != nil { return CanvasPluginRecord{}, err }
	id := "custom-"+identifier()
	node := canvasNodeSpec{Type: id+":node", Title: strings.TrimSpace(name), DefaultMetadata: map[string]any{"content": ""}}
	node.DefaultSize.Width, node.DefaultSize.Height = 340, 240
	manifest := canvasPluginManifest{SchemaVersion: 1, ID: id, Name: strings.TrimSpace(name), Description: description, Entry: "index.tsx", Nodes: []canvasNodeSpec{node}}
	files := encode(map[string]string{"plugin.json": prettyJSON(manifest), "index.tsx": "import { definePlugin } from '@dream-canvas/plugin-sdk';\nimport manifest from './plugin.json';\n\nexport default definePlugin({\n  id: manifest.id, name: manifest.name, version: '1.0.0',\n  nodes: [{ ...manifest.nodes[0], hidePanel: true,\n    Content: ({ ctx }) => <textarea value={ctx.node.metadata.content || ''}\n      onChange={event => ctx.updateMetadata({ content: event.target.value })}\n      onPointerDown={event => event.stopPropagation()}\n      onKeyDown={event => event.stopPropagation()}\n      onWheel={event => event.stopPropagation()}\n      style={{ width: '100%', height: '100%', padding: 12, border: 0, resize: 'none', background: 'transparent', color: ctx.theme.node.text }} />\n  }],\n});\n"})
	record := CanvasPluginRecord{ID: id, Name: manifest.Name, Description: description, Version: 1, Nodes: encode(manifest.Nodes)}
	err := a.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&record).Error; err != nil { return err }
		return tx.Create(&CanvasPluginDraft{PluginID: id, Revision: 1, Files: files, UpdatedBy: user.ID}).Error
	})
	if err == nil { a.notifyCatalog() }; return record, err
}

func canvasPluginPath(name string) bool {
	if name == "" || path.IsAbs(name) || path.Clean(name) != name || strings.ContainsAny(name, "\\:\x00\r\n") { return false }
	for _, part := range strings.Split(name, "/") { if strings.HasPrefix(part, ".") { return false } }
	return includes([]string{".js", ".jsx", ".ts", ".tsx", ".json", ".css"}, path.Ext(name))
}

func readCanvasPluginPackage(id string, files map[string]string) (canvasPluginManifest, error) {
	var manifest canvasPluginManifest
	invalid := func() (canvasPluginManifest, error) { return manifest, problem(400, "invalid_canvas_plugin", "plugin.json 需要 schemaVersion:1、固定插件 ID、名称、包内 entry 和不重复的节点定义；节点类型以插件 ID 加冒号开头，尺寸必须大于零") }
	if files == nil { return invalid() }
	for name, content := range files {
		if !canvasPluginPath(name) || !utf8.ValidString(content) { return manifest, problem(400, "invalid_plugin_file", "节点插件仅支持包内 UTF-8 JS、TS、JSX、TSX、JSON 和 CSS 文件") }
		if path.Ext(name) == ".json" && !json.Valid([]byte(content)) { return manifest, problem(400, "invalid_plugin_json", "JSON 文件无效："+name) }
	}
	if json.Unmarshal([]byte(files["plugin.json"]), &manifest) != nil || manifest.SchemaVersion != 1 || manifest.ID != id || strings.TrimSpace(manifest.Name) == "" || !canvasPluginPath(manifest.Entry) || !includes([]string{".js", ".jsx", ".ts", ".tsx"}, path.Ext(manifest.Entry)) || files[manifest.Entry] == "" || len(manifest.Nodes) == 0 { return invalid() }
	seen := map[string]bool{}
	for _, node := range manifest.Nodes {
		if !strings.HasPrefix(node.Type, id+":") || strings.TrimPrefix(node.Type, id+":") == "" || seen[node.Type] || strings.TrimSpace(node.Title) == "" || node.DefaultSize.Width <= 0 || node.DefaultSize.Height <= 0 { return invalid() }
		seen[node.Type] = true
	}
	return manifest, nil
}

func (a *App) SaveCanvasPluginDraft(user User, id string, revision uint64, files map[string]string) (CanvasPluginDraft, error) {
	if _, err := readCanvasPluginPackage(id, files); err != nil { return CanvasPluginDraft{}, err }
	var draft CanvasPluginDraft
	err := a.db.Transaction(func(tx *gorm.DB) error {
		var record CanvasPluginRecord
		if err := tx.First(&record, "id = ?", id).Error; err != nil { return err }
		if record.Builtin { return problem(403, "builtin_readonly", "内置节点插件只允许启用或停用") }
		result := tx.Model(&CanvasPluginDraft{}).Where("plugin_id = ? AND revision = ?", id, revision).Updates(map[string]any{"files": encode(files), "revision": revision+1, "updated_by": user.ID, "updated_at": time.Now()})
		if result.Error != nil { return result.Error }; if result.RowsAffected != 1 { return problem(409, "version_conflict", "节点插件草稿已更新，请重新读取；本次编辑尚未保存") }
		return tx.First(&draft, "plugin_id = ?", id).Error
	})
	if err == nil { a.notifyCatalog() }
	return draft, err
}

// Compile only virtual files. Plugin code runs in the browser after administrator publication.
func compileCanvasPlugin(manifest canvasPluginManifest, files map[string]string) (string, error) {
	bridge := "const React = globalThis.InfiniteCanvasRuntime.React; export default React; export const {useState,useEffect,useLayoutEffect,useMemo,useCallback,useRef,useReducer,useContext,useId,createElement,Fragment} = React; export const definePlugin = value => value; export const getRuntime = () => globalThis.InfiniteCanvasRuntime; export const getReact = () => React;"
	loader := api.Plugin{Name: "canvas-plugin", Setup: func(build api.PluginBuild) {
		build.OnResolve(api.OnResolveOptions{Filter: ".*"}, func(args api.OnResolveArgs) (api.OnResolveResult, error) {
			if args.Path == "react" || args.Path == "@dream-canvas/plugin-sdk" { return api.OnResolveResult{Path: "runtime", Namespace: "canvas-plugin"}, nil }
			if !strings.HasPrefix(args.Path, "./") && !strings.HasPrefix(args.Path, "../") { return api.OnResolveResult{}, errors.New("only host React, the canvas SDK and relative package imports are allowed") }
			name := path.Join(path.Dir(args.Importer), args.Path)
			if !canvasPluginPath(name) { return api.OnResolveResult{}, errors.New("import escapes the plugin package") }
			if _, exists := files[name]; !exists { return api.OnResolveResult{}, errors.New("package file not found: "+name) }
			return api.OnResolveResult{Path: name, Namespace: "canvas-plugin"}, nil
		})
		build.OnLoad(api.OnLoadOptions{Filter: ".*", Namespace: "canvas-plugin"}, func(args api.OnLoadArgs) (api.OnLoadResult, error) {
			if args.Path == "runtime" { return api.OnLoadResult{Contents: &bridge, Loader: api.LoaderJS}, nil }
			content, exists := files[args.Path]; if !exists { return api.OnLoadResult{}, errors.New("package file not found") }
			kind := map[string]api.Loader{".js": api.LoaderJSX, ".jsx": api.LoaderJSX, ".ts": api.LoaderTS, ".tsx": api.LoaderTSX, ".json": api.LoaderJSON, ".css": api.LoaderText}[path.Ext(args.Path)]
			return api.OnLoadResult{Contents: &content, Loader: kind}, nil
		})
	}}
	entry := "export { default } from "+string(encode("./"+manifest.Entry))+";"
	result := api.Build(api.BuildOptions{Stdin: &api.StdinOptions{Contents: entry, Sourcefile: "__entry.js", Loader: api.LoaderJS}, Bundle: true, Write: false, Format: api.FormatIIFE, GlobalName: "__canvasPlugin", Platform: api.PlatformBrowser, Target: api.ES2020, JSXFactory: "globalThis.InfiniteCanvasRuntime.React.createElement", JSXFragment: "globalThis.InfiniteCanvasRuntime.React.Fragment", LogLevel: api.LogLevelSilent, Plugins: []api.Plugin{loader}})
	if len(result.Errors) > 0 { message := result.Errors[0]; location := ""; if message.Location != nil { location = message.Location.File+":"+string(encode(message.Location.Line))+" " }; return "", problem(400, "plugin_compile_failed", location+message.Text) }
	if len(result.OutputFiles) != 1 { return "", problem(400, "plugin_compile_failed", "节点插件必须生成一个模块") }
	return "export default runtime => {\n"+string(result.OutputFiles[0].Contents)+"\nconst value = __canvasPlugin.default; return typeof value === 'function' ? value(runtime) : value;\n};\n", nil
}

func (a *App) PublishCanvasPlugin(user User, id string, revision, version uint64, confirmed bool) (CanvasPluginRecord, error) {
	if !confirmed { return CanvasPluginRecord{}, problem(400, "confirmation_required", "请由管理员确认发布；节点插件在所有使用者的浏览器中执行，可访问页面与当前账号授权的同源业务接口") }
	var record CanvasPluginRecord; var draft CanvasPluginDraft
	if err := a.db.First(&record, "id = ?", id).Error; err != nil { return record, err }
	if record.Builtin { return record, problem(403, "builtin_readonly", "内置节点插件不允许修改或发布") }
	if err := a.db.First(&draft, "plugin_id = ? AND revision = ?", id, revision).Error; err != nil { return record, problem(409, "version_conflict", "节点插件草稿已更新，请重新读取") }
	var files map[string]string; if json.Unmarshal(draft.Files, &files) != nil { return record, problem(409, "invalid_canvas_plugin", "节点插件草稿无法读取") }
	manifest, err := readCanvasPluginPackage(id, files); if err != nil { return record, err }
	source, err := compileCanvasPlugin(manifest, files); if err != nil { return record, err }
	published := CanvasPluginVersion{ID: identifier(), PluginID: id, Revision: revision, Files: draft.Files, Source: source, PublishedBy: user.ID}
	err = a.db.Transaction(func(tx *gorm.DB) error {
		var current CanvasPluginDraft
		if err := tx.First(&current, "plugin_id = ? AND revision = ?", id, revision).Error; err != nil { return problem(409, "version_conflict", "节点插件草稿已更新，请重新读取") }
		// Keep node types stable so saved project history remains addressable.
		var previous []canvasNodeSpec; if record.PublishedVersionID != "" { _ = json.Unmarshal(record.Nodes, &previous) }
		types := []string{}; for _, node := range manifest.Nodes { types = append(types, node.Type) }
		for _, node := range previous { if !includes(types, node.Type) { return problem(409, "plugin_node_type_changed", "已登记的节点类型不能从发布版本中移除；请保留原类型以便历史节点恢复") } }
		result := tx.Model(&CanvasPluginRecord{}).Where("id = ? AND version = ? AND builtin = ?", id, version, false).Updates(map[string]any{"name": manifest.Name, "description": manifest.Description, "nodes": encode(manifest.Nodes), "published_version_id": published.ID, "version": version+1, "updated_at": time.Now()})
		if result.Error != nil { return result.Error }; if result.RowsAffected != 1 { return problem(409, "version_conflict", "节点插件已更新，请重新读取") }
		if err := tx.Create(&published).Error; err != nil { return err }
		return tx.First(&record, "id = ?", id).Error
	})
	if err == nil { a.notifyCatalog() }; return record, err
}

func (a *App) SetCanvasPluginEnabled(id string, version uint64, enabled bool) (CanvasPluginRecord, error) {
	var record CanvasPluginRecord
	err := a.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.First(&record, "id = ?", id).Error; err != nil { return err }
		if enabled && record.PublishedVersionID == "" { return problem(400, "plugin_unpublished", "请先发布节点插件，再启用") }
		result := tx.Model(&CanvasPluginRecord{}).Where("id = ? AND version = ?", id, version).Updates(map[string]any{"enabled": enabled, "version": version+1, "updated_at": time.Now()})
		if result.Error != nil { return result.Error }; if result.RowsAffected != 1 { return problem(409, "version_conflict", "节点插件已更新，请重新读取后设置") }
		return tx.First(&record, "id = ?", id).Error
	})
	if err == nil { a.notifyCatalog() }; return record, err
}

func (a *App) DeleteCanvasPlugin(id string, version uint64, confirmed bool) error {
	if !confirmed { return problem(400, "confirmation_required", "请确认删除自建节点插件及其草稿和发布版本") }
	err := a.db.Transaction(func(tx *gorm.DB) error {
		var record CanvasPluginRecord
		if err := tx.First(&record, "id = ?", id).Error; err != nil { return err }
		if record.Builtin { return problem(403, "builtin_readonly", "内置节点插件不允许删除") }
		if record.Version != version { return problem(409, "version_conflict", "节点插件已更新，请重新读取") }
		var nodes []canvasNodeSpec; if json.Unmarshal(record.Nodes, &nodes) != nil { return problem(409, "invalid_canvas_plugin", "节点定义无法读取") }
		for _, node := range nodes {
			for _, table := range []string{"projects", "project_revisions"} {
				var count int64
				if err := tx.Table(table).Where("EXISTS (SELECT 1 FROM json_each("+table+".document, '$.nodes') AS n WHERE json_extract(n.value, '$.type') = ?)", node.Type).Count(&count).Error; err != nil { return err }
				if count > 0 { return problem(409, "plugin_in_use", "项目或撤销历史仍引用此插件，请停用以保留节点恢复能力") }
			}
		}
		if err := tx.Delete(&CanvasPluginDraft{}, "plugin_id = ?", id).Error; err != nil { return err }
		if err := tx.Delete(&CanvasPluginVersion{}, "plugin_id = ?", id).Error; err != nil { return err }
		return tx.Delete(&record).Error
	})
	if err == nil { a.notifyCatalog() }; return err
}

func checkCanvasNodeTypes(tx *gorm.DB, before, after JSON) error {
	var oldDocument, nextDocument map[string]any
	if len(before) > 0 && json.Unmarshal(before, &oldDocument) != nil { return problem(409, "invalid_document", "原画布无法读取") }
	if json.Unmarshal(after, &nextDocument) != nil { return problem(400, "invalid_document", "画布无法读取") }
	previous := map[string]string{}
	for _, raw := range array(oldDocument["nodes"]) { node := object(raw); previous[text(node["id"])] = text(node["type"]) }
	needed := map[string]bool{}
	for _, raw := range array(nextDocument["nodes"]) { node := object(raw); kind := text(node["type"]); if previous[text(node["id"])] != kind { needed[kind] = true } }
	if len(needed) == 0 { return nil }
	rows := []CanvasPluginRecord{}; if err := tx.Where("enabled = ? AND published_version_id <> ?", true, "").Find(&rows).Error; err != nil { return err }
	for _, row := range rows { var nodes []canvasNodeSpec; if json.Unmarshal(row.Nodes, &nodes) != nil { return problem(409, "invalid_canvas_plugin", "节点插件目录无法读取") }; for _, node := range nodes { delete(needed, node.Type) } }
	if len(needed) > 0 { return problem(400, "node_type_unavailable", "新增节点使用的插件不存在、未发布或已停用，请刷新节点目录；已有节点内容会保留") }
	return nil
}

func requireCanvasNodeType(tx *gorm.DB, kind string) error {
	var count int64
	err := tx.Model(&CanvasPluginRecord{}).Where("enabled = ? AND published_version_id <> ? AND EXISTS (SELECT 1 FROM json_each(canvas_plugin_records.nodes) AS n WHERE json_extract(n.value, '$.type') = ?)", true, "", kind).Count(&count).Error
	if err != nil { return err }; if count == 0 { return problem(400, "node_type_unavailable", "节点插件不存在、未发布或已停用，不能提交新的节点生成任务") }; return nil
}

func canvasPluginContract(locale string) map[string]any {
	if locale == "en-US" { return map[string]any{
		"package": "The complete files map contains plugin.json with schemaVersion:1, immutable id, name, description, entry and nodes (type/title/defaultSize/defaultMetadata). Node types start with the plugin ID and a colon. The entry exports definePlugin({...}) as default; read metadata from plugin.json and implement Content/Panel/toolbar.",
		"imports": "Only relative package JS/TS/JSX/TSX/JSON/CSS modules, react and @dream-canvas/plugin-sdk are resolved. Import CSS as a string and assign it to plugin.css. No remote modules, npm installation, server files or system commands.",
		"runtime": "The SDK supplies definePlugin, React hooks and getRuntime/getReact. Content receives {ctx}: node/theme/scale/isSelected, updateMetadata(patch), updateNode({title,width,height}), getNode/getNodes/getConnections/getUpstream/getDownstream, applyOps, ai, openPanel/closePanel and storage. Project content belongs in metadata. Media must use stable server asset references. ctx.ai uses the shared server business layer.",
		"interaction": "Stop propagation of pointerdown, keydown and wheel on controls; use data-canvas-no-zoom for scrolling regions. Follow ctx.theme and semantic theme tokens. hidePanel hides generation panels, interactionToggle supplies move/interact, and forceInteractive can make editing interactive.",
		"publication": "The assistant may create and save drafts only. Administrators actively publish, delete and control availability. Publishing compiles and fixes the complete package. Saving a draft does not affect published code. Node plugins execute in users' browsers with access to the page and authorized same-origin APIs; they have a different execution boundary from server-isolated API plugins.",
	} }
	return map[string]any{"package": "完整 files 映射：plugin.json 含 schemaVersion:1、不可变 id、name、description、entry 和 nodes（type/title/defaultSize/defaultMetadata）。节点类型以插件 id 加冒号开头。入口默认导出 definePlugin({...})，从 plugin.json 读取节点元数据，Content/Panel/toolbar 负责交互。", "imports": "仅允许包内相对 JS/TS/JSX/TSX/JSON/CSS 模块、react 和 @dream-canvas/plugin-sdk；CSS 作为字符串导入后放入插件 css。禁止远程模块、npm 安装、服务器文件或系统命令。", "runtime": "SDK 提供 definePlugin、React hooks、getRuntime/getReact。Content 接收 {ctx}：node/theme/scale/isSelected、updateMetadata(patch)、updateNode({title,width,height})、getNode/getNodes/getConnections/getUpstream/getDownstream、applyOps、ai、openPanel/closePanel、storage。内容写 metadata；媒体必须先保存为服务端资产引用。AI 经 ctx.ai 调用同一服务端业务。", "interaction": "控件的 pointerdown、keydown、wheel 事件应阻止冒泡，滚动区域使用 data-canvas-no-zoom；沿用 ctx.theme 和语义主题。hidePanel 隐藏生成面板，interactionToggle 支持交互/移动切换，forceInteractive 可在编辑态强制交互。", "publication": "助手只能创建和修改草稿，发布、删除和全站启停由管理员主动确认。发布编译并固定整个包，保存草稿不影响已发布版本。节点插件在使用者浏览器中执行，具备当前页面和同源业务权限，与服务端隔离运行的接口插件有不同的运行边界。"}
}

func (a *App) canvasPluginRoutes(authed, admin *gin.RouterGroup) {
	authed.GET("/canvas-plugins", func(c *gin.Context) { rows, err := a.CanvasPluginCatalog(); if err != nil { respondError(c, err); return }; c.JSON(200, rows) })
	admin.GET("/canvas-plugin-contract", func(c *gin.Context) { c.JSON(200, canvasPluginContract(c.Query("locale"))) })
	admin.GET("/canvas-plugins", func(c *gin.Context) { rows, err := a.ListCanvasPlugins(); if err != nil { respondError(c, err); return }; c.JSON(200, rows) })
	admin.POST("/canvas-plugins", func(c *gin.Context) { var input struct { Name string `json:"name"`; Description string `json:"description"` }; if !bind(c, &input) { return }; row, err := a.CreateCanvasPlugin(currentUser(c), input.Name, input.Description); if err != nil { respondError(c, err); return }; c.JSON(201, row) })
	admin.GET("/canvas-plugins/:id", func(c *gin.Context) { detail, err := a.GetCanvasPlugin(c.Param("id")); if err != nil { respondError(c, err); return }; c.JSON(200, detail) })
	admin.PUT("/canvas-plugins/:id/draft", func(c *gin.Context) { var input struct { Revision uint64 `json:"revision"`; Files map[string]string `json:"files"` }; if !bind(c, &input) { return }; draft, err := a.SaveCanvasPluginDraft(currentUser(c), c.Param("id"), input.Revision, input.Files); if err != nil { respondError(c, err); return }; c.JSON(200, draft) })
	admin.POST("/canvas-plugins/:id/publish", func(c *gin.Context) { var input struct { Revision uint64 `json:"revision"`; Version uint64 `json:"version"`; Confirmed bool `json:"confirmed"` }; if !bind(c, &input) { return }; row, err := a.PublishCanvasPlugin(currentUser(c), c.Param("id"), input.Revision, input.Version, input.Confirmed); if err != nil { respondError(c, err); return }; c.JSON(200, row) })
	admin.PUT("/canvas-plugins/:id/enabled", func(c *gin.Context) { var input struct { Version uint64 `json:"version"`; Enabled *bool `json:"enabled"` }; if !bind(c, &input) { return }; if input.Enabled == nil { respondError(c, problem(400, "invalid_input", "请明确节点插件启停状态")); return }; row, err := a.SetCanvasPluginEnabled(c.Param("id"), input.Version, *input.Enabled); if err != nil { respondError(c, err); return }; c.JSON(200, row) })
	admin.DELETE("/canvas-plugins/:id", func(c *gin.Context) { var input struct { Version uint64 `json:"version"`; Confirmed bool `json:"confirmed"` }; if !bind(c, &input) { return }; if err := a.DeleteCanvasPlugin(c.Param("id"), input.Version, input.Confirmed); err != nil { respondError(c, err); return }; c.Status(204) })
}
