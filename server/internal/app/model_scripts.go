package app

import (
	"embed"
	"errors"
	"io/fs"
	"strings"
	"sync"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

//go:embed model_scripts
var scriptFiles embed.FS

type builtinScript struct { ID, Name, Capability, Description string; Files, Parameters, Scripts JSON }

var builtinCatalog struct { sync.Once; scripts []builtinScript; err error }

func builtinVersionID(script builtinScript) string { return script.ID+"-"+digest(string(script.Files)) }

func builtinScripts() ([]builtinScript, error) {
	builtinCatalog.Do(func() { builtinCatalog.scripts, builtinCatalog.err = loadBuiltinScripts() }); return builtinCatalog.scripts, builtinCatalog.err
}

func loadBuiltinScripts() ([]builtinScript, error) {
	folders, err := scriptFiles.ReadDir("model_scripts"); if err != nil { return nil, err }
	scripts := []builtinScript{}
	for _, folder := range folders {
		if !folder.IsDir() { continue }; root := "model_scripts/"+folder.Name(); files := map[string]string{}
		if err := fs.WalkDir(scriptFiles, root, func(name string, entry fs.DirEntry, err error) error { if err != nil { return err }; if entry.IsDir() { return nil }; content, err := scriptFiles.ReadFile(name); if err != nil { return err }; files[strings.TrimPrefix(name, root+"/")] = string(content); return nil }); err != nil { return nil, err }
		raw := encode(files); manifest, _, _, err := readScriptPackage(raw); if err != nil { return nil, err }; compiled, parameters, err := compileScriptPackage(raw); if err != nil { return nil, err }
		scripts = append(scripts, builtinScript{ID: folder.Name(), Name: manifest.Name, Capability: manifest.Capability, Description: manifest.Description, Files: raw, Parameters: parameters, Scripts: compiled})
	}
	return scripts, nil
}

func (a *App) installBuiltinScripts() error {
	scripts, err := builtinScripts(); if err != nil { return err }
	for _, definition := range scripts {
		err := a.db.Transaction(func(tx *gorm.DB) error {
			var existing ModelScript; err := tx.First(&existing, "id = ?", definition.ID).Error
			if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) { return err }
			version := ScriptVersion{ID: builtinVersionID(definition), AdapterID: definition.ID, DraftRevision: 1, Files: definition.Files, Scripts: definition.Scripts, Parameters: definition.Parameters, Features: scriptFeatures(definition.Files), PublishedBy: "builtin"}
			script := ModelScript{ID: definition.ID, Name: definition.Name, Capability: definition.Capability, Description: definition.Description, Builtin: true, AdapterVersionID: version.ID, Version: 1}
			if existing.ID == "" { if err := tx.Create(&script).Error; err != nil { return err }
			} else {
				if !existing.Builtin { return errors.New("builtin script ID is already in use") }; if existing.AdapterVersionID == version.ID { return nil }
				version.DraftRevision = existing.Version+1
				if err := tx.Model(&existing).Updates(map[string]any{"name": script.Name, "description": script.Description, "adapter_version_id": version.ID, "version": existing.Version+1}).Error; err != nil { return err }
			}
			return tx.Where("id = ?", version.ID).FirstOrCreate(&version).Error
		}); if err != nil { return err }
	}; return nil
}

func (a *App) listModelScripts(c *gin.Context) {
	rows, err := a.ListModelScripts(); if err != nil { respondError(c, err); return }; c.JSON(200, rows)
}

func (a *App) ListModelScripts() ([]ModelScript, error) { rows := []ModelScript{}; err := a.db.Order("builtin DESC, created_at").Find(&rows).Error; return rows, err }

func (a *App) attachModelScript(snapshot *executionSnapshot) error {
	if snapshot.Model.AdapterVersionID == "" { return problem(400, "interface_unpublished", "请选择已发布的接口脚本版本") }
	snapshot.Script = &ScriptVersion{}
	return a.db.First(snapshot.Script, "id = ? AND adapter_id = ?", snapshot.Model.AdapterVersionID, snapshot.Model.AdapterID).Error
}

type scriptInput struct { Name string `json:"name"`; Capability string `json:"capability"`; Description string `json:"description"`; CopyFrom string `json:"copyFrom"`; Files JSON `json:"files"` }

func (a *App) createModelScript(c *gin.Context) {
	var input scriptInput; if !bind(c, &input) { return }; script, err := a.CreateModelScript(currentUser(c), input); if err != nil { respondError(c, err); return }; c.JSON(201, script)
}

func (a *App) CreateModelScript(user User, input scriptInput) (ModelScript, error) {
	if len(input.Files) > 0 && string(input.Files) != "null" {
		if input.CopyFrom != "" { return ModelScript{}, problem(400, "invalid_script_package", "整包导入与复制脚本不能同时使用") }
		manifest, _, _, err := readScriptPackage(input.Files); if err != nil { return ModelScript{}, err }; input.Name, input.Capability, input.Description = manifest.Name, manifest.Capability, manifest.Description
	}
	if err := validTitle(input.Name); err != nil { return ModelScript{}, err }
	if !includes([]string{"text", "image", "video", "audio"}, input.Capability) { return ModelScript{}, problem(400, "invalid_capability", "请选择接口脚本能力") }
	script := ModelScript{ID: identifier(), Name: strings.TrimSpace(input.Name), Capability: input.Capability, Description: strings.TrimSpace(input.Description), Version: 1}
	err := a.db.Transaction(func(tx *gorm.DB) error {
		files := newScriptPackage(script.Name, script.Capability, script.Description)
		if len(input.Files) > 0 && string(input.Files) != "null" { files = input.Files }
		if input.CopyFrom != "" { var source ModelScript; if err := tx.First(&source, "id = ? AND capability = ?", input.CopyFrom, input.Capability).Error; err != nil { return err }; if source.Builtin { return problem(403, "builtin_readonly", "内置接口脚本只允许查看和选择使用，不允许复制或修改") }
			var draft ScriptDraft; err := tx.First(&draft, "adapter_id = ?", source.ID).Error
			if err == nil { files = draft.Files } else if errors.Is(err, gorm.ErrRecordNotFound) && source.AdapterVersionID != "" { var version ScriptVersion; if err := tx.First(&version, "id = ?", source.AdapterVersionID).Error; err != nil { return err }; files = version.Files } else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) { return err }
			manifest, content, _, err := readScriptPackage(files); if err != nil { return err }; manifest.Name, manifest.Description = script.Name, script.Description; content["script.json"] = prettyJSON(manifest); files = encode(content)
		}
		if err := tx.Create(&script).Error; err != nil { return err }
		_, _, parameters, err := readScriptPackage(files); if err != nil { return err }
		return tx.Create(&ScriptDraft{ID: identifier(), AdapterID: script.ID, Revision: 1, Files: files, Parameters: parameters, UpdatedBy: user.ID}).Error
	}); if err == nil { a.notifyCatalog() }; return script, err
}

func (a *App) getModelScript(c *gin.Context) {
	value, err := a.GetModelScript(c.Param("adapterId")); if err != nil { respondError(c, err); return }; c.JSON(200, value)
}

func (a *App) GetModelScript(adapterID string) (gin.H, error) {
	var script ModelScript; if err := a.db.First(&script, "id = ?", adapterID).Error; err != nil { return nil, err }
	draft := ScriptDraft{}; err := a.db.First(&draft, "adapter_id = ?", script.ID).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) { return nil, err }
	versions := []ScriptVersion{}; if err := a.db.Where("adapter_id = ?", script.ID).Omit("Scripts").Order("created_at DESC").Find(&versions).Error; err != nil { return nil, err }
	if errors.Is(err, gorm.ErrRecordNotFound) {
		draft = ScriptDraft{AdapterID: script.ID, Files: JSON(`{}`), Parameters: JSON(`[]`)}
		for _, version := range versions { if version.ID == script.AdapterVersionID { draft.Revision, draft.Files, draft.Parameters = version.DraftRevision, version.Files, version.Parameters; break } }
	}
	models := []ChannelModel{}; if err := a.db.Where("adapter_id = ?", script.ID).Find(&models).Error; err != nil { return nil, err }
	return gin.H{"script": script, "draft": draft, "versions": versions, "models": models}, nil
}

func (a *App) writeScriptDraft(tx *gorm.DB, user User, adapterID string, input ScriptDraft) (ScriptDraft, error) {
	var script ModelScript; var draft ScriptDraft
	if err := tx.First(&script, "id = ?", adapterID).Error; err != nil { return draft, err }; if script.Builtin { return draft, problem(403, "builtin_readonly", "内置接口脚本只允许查看和选择使用，不允许复制或修改") }
	manifest, _, parameters, err := readScriptPackage(input.Files); if err != nil { return draft, err }; if manifest.Capability != script.Capability { return draft, problem(400, "invalid_capability", "脚本能力创建后不可变更，请创建另一脚本") }
	if err := tx.First(&draft, "adapter_id = ?", script.ID).Error; err != nil { return draft, err }; if draft.Revision != input.Revision { return draft, problem(409, "version_conflict", "脚本草稿已更新，当前编辑未覆盖") }
	if err := tx.Model(&draft).Updates(map[string]any{"files": input.Files, "parameters": parameters, "revision": draft.Revision+1, "updated_by": user.ID}).Error; err != nil { return draft, err }
	if err := tx.Model(&script).Updates(map[string]any{"name": strings.TrimSpace(manifest.Name), "description": strings.TrimSpace(manifest.Description), "version": script.Version+1}).Error; err != nil { return draft, err }
	err = tx.First(&draft, "id = ?", draft.ID).Error; return draft, err
}

func (a *App) saveScriptDraft(c *gin.Context) {
	var input ScriptDraft; if !bind(c, &input) { return }; draft, err := a.SaveScriptDraft(currentUser(c), c.Param("adapterId"), input); if err != nil { respondError(c, err); return }; c.JSON(200, draft)
}

func (a *App) SaveScriptDraft(user User, adapterID string, input ScriptDraft) (ScriptDraft, error) {
	var draft ScriptDraft
	err := a.db.Transaction(func(tx *gorm.DB) error { var err error; draft, err = a.writeScriptDraft(tx, user, adapterID, input); return err }); if err == nil { a.notifyCatalog() }; return draft, err
}

func (a *App) publishModelScript(c *gin.Context) {
	var input struct { Revision uint64 `json:"revision"`; ScriptVersion uint64 `json:"scriptVersion"` }; if !bind(c, &input) { return }; version, err := a.PublishModelScript(currentUser(c), c.Param("adapterId"), input.Revision, input.ScriptVersion); if err != nil { respondError(c, err); return }; c.JSON(201, version)
}

func (a *App) PublishModelScript(user User, adapterID string, revision, scriptVersion uint64) (ScriptVersion, error) {
	var selected ModelScript; if err := a.db.First(&selected, "id = ?", adapterID).Error; err != nil { return ScriptVersion{}, err }; if selected.Builtin { return ScriptVersion{}, problem(403, "builtin_readonly", "内置接口脚本只允许查看和选择使用，不允许复制或修改") }
	var prepared ScriptDraft; if err := a.db.First(&prepared, "adapter_id = ?", adapterID).Error; err != nil { return ScriptVersion{}, err }; if prepared.Revision != revision { return ScriptVersion{}, problem(409, "version_conflict", "草稿已更新，请重新读取") }
	scripts, parameters, err := compileScriptPackage(prepared.Files); if err != nil { return ScriptVersion{}, err }
	var version ScriptVersion
	err = a.db.Transaction(func(tx *gorm.DB) error {
		var script ModelScript; var draft ScriptDraft
		if err := tx.First(&script, "id = ?", adapterID).Error; err != nil { return err }; if script.Builtin { return problem(403, "builtin_readonly", "内置接口脚本只允许查看和选择使用，不允许复制或修改") }; if script.Version != scriptVersion { return problem(409, "version_conflict", "脚本已更新，请重新读取") }
		if err := tx.First(&draft, "adapter_id = ?", script.ID).Error; err != nil { return err }; if draft.Revision != revision { return problem(409, "version_conflict", "草稿已更新，请重新读取") }
		version = ScriptVersion{ID: identifier(), AdapterID: script.ID, DraftRevision: draft.Revision, Files: draft.Files, Scripts: scripts, Parameters: parameters, Features: scriptFeatures(draft.Files), PublishedBy: user.ID}
		
		if err := tx.Create(&version).Error; err != nil { return err }; return tx.Model(&script).Updates(map[string]any{"adapter_version_id": version.ID, "version": script.Version+1}).Error
	}); if err == nil { a.notifyCatalog() }; return version, err
}
