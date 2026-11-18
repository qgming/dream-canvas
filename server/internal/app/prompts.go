package app

import (
	"context"
	_ "embed"
	"encoding/json"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

//go:embed builtin_prompts.json
var builtinPromptsJSON []byte

type Prompt struct {
	ID string `json:"id" gorm:"primaryKey"`
	UserID string `json:"-" gorm:"index"`
	Title string `json:"title"`
	Description string `json:"description"`
	Prompt string `json:"prompt"`
	Type string `json:"type"`
	Category string `json:"category"`
	BuiltIn bool `json:"builtIn" gorm:"-"`
	Version uint64 `json:"version"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type promptInput struct {
	Title string `json:"title"`
	Description string `json:"description"`
	Prompt string `json:"prompt"`
	Type string `json:"type"`
	Category string `json:"category"`
	Version uint64 `json:"version"`
}

func loadBuiltinPrompts(locale string) ([]Prompt, error) {
	var entries []struct { Prompt; English promptInput `json:"en"` }
	if err := json.Unmarshal(builtinPromptsJSON, &entries); err != nil { return nil, err }
	rows := []Prompt{}
	for _, entry := range entries {
		row := entry.Prompt; row.BuiltIn, row.Version = true, 1
		if locale == "en-US" { row.Title, row.Description, row.Prompt, row.Category = entry.English.Title, entry.English.Description, entry.English.Prompt, entry.English.Category }
		rows = append(rows, row)
	}
	return rows, nil
}

func isBuiltinPrompt(id string) bool { return strings.HasPrefix(id, "builtin:") }

func (a *App) ListPrompts(ctx context.Context, userID, locale string) ([]Prompt, error) {
	rows, err := loadBuiltinPrompts(locale); if err != nil { return nil, err }
	personal := []Prompt{}
	if err := a.db.WithContext(ctx).Where("user_id = ?", userID).Order("updated_at DESC, id").Find(&personal).Error; err != nil { return nil, err }
	return append(rows, personal...), nil
}

func (a *App) GetPrompt(ctx context.Context, userID, id, locale string) (Prompt, error) {
	if isBuiltinPrompt(id) {
		rows, err := loadBuiltinPrompts(locale); if err != nil { return Prompt{}, err }
		for _, row := range rows { if row.ID == id { return row, nil } }
		return Prompt{}, gorm.ErrRecordNotFound
	}
	var row Prompt; err := a.db.WithContext(ctx).First(&row, "id = ? AND user_id = ?", id, userID).Error; return row, err
}

func (a *App) SavePrompt(userID, id string, input promptInput, create bool) (Prompt, error) {
	if isBuiltinPrompt(id) { return Prompt{}, problem(403, "builtin_readonly", "内置提示词仅可查看和使用") }
	input.Title, input.Prompt = strings.TrimSpace(input.Title), strings.TrimSpace(input.Prompt)
	if input.Title == "" || input.Prompt == "" { return Prompt{}, problem(400, "prompt_required", "请输入提示词名称与内容") }
	if !includes([]string{"text", "image", "video"}, input.Type) { return Prompt{}, problem(400, "invalid_prompt_type", "请选择文本、图片或视频提示词") }
	row := Prompt{ID: id, UserID: userID}
	err := a.db.Transaction(func(tx *gorm.DB) error {
		if create {
			if input.Version != 0 { return problem(409, "version_conflict", "新建提示词版本应为 0") }
			row.ID, row.Title, row.Description, row.Prompt, row.Type, row.Category, row.Version = identifier(), input.Title, strings.TrimSpace(input.Description), input.Prompt, input.Type, strings.TrimSpace(input.Category), 1
			return tx.Create(&row).Error
		}
		result := tx.Model(&Prompt{}).Where("id = ? AND user_id = ? AND version = ?", id, userID, input.Version).Updates(map[string]any{"title": input.Title, "description": strings.TrimSpace(input.Description), "prompt": input.Prompt, "type": input.Type, "category": strings.TrimSpace(input.Category), "version": input.Version + 1})
		if result.Error != nil { return result.Error }; if result.RowsAffected == 0 { return problem(409, "version_conflict", "提示词已更新或删除，当前编辑未覆盖服务端，请重新读取") }
		return tx.First(&row, "id = ? AND user_id = ?", id, userID).Error
	})
	if err == nil { a.notifyTopic(userID, "prompts") }; return row, err
}

func (a *App) DeletePrompt(userID, id string, version uint64) error {
	if isBuiltinPrompt(id) { return problem(403, "builtin_readonly", "内置提示词仅可查看和使用") }
	result := a.db.Delete(&Prompt{}, "id = ? AND user_id = ? AND version = ?", id, userID, version)
	if result.Error != nil { return result.Error }; if result.RowsAffected == 0 { return problem(409, "version_conflict", "提示词已更新或删除，请重新读取后删除") }
	a.notifyTopic(userID, "prompts"); return nil
}

func (a *App) listPrompts(c *gin.Context) {
	rows, err := a.ListPrompts(c.Request.Context(), currentUser(c).ID, c.Query("locale")); if err != nil { respondError(c, err); return }
	scope := c.DefaultQuery("scope", "all")
	if !includes([]string{"all", "builtin", "user"}, scope) { respondError(c, problem(400, "invalid_prompt_scope", "请选择内置提示词或我的提示词")); return }
	promptType := c.DefaultQuery("type", "all")
	if !includes([]string{"all", "text", "image", "video"}, promptType) { respondError(c, problem(400, "invalid_prompt_type", "请选择文本、图片或视频提示词")); return }
	keyword, category := strings.ToLower(strings.TrimSpace(c.Query("keyword"))), c.Query("category")
	items, categories := []Prompt{}, []string{}
	for _, row := range rows {
		if scope == "builtin" && !row.BuiltIn || scope == "user" && row.BuiltIn { continue }
		if promptType != "all" && row.Type != promptType { continue }
		if row.Category != "" && !includes(categories, row.Category) { categories = append(categories, row.Category) }
		if category != "" && category != "all" && row.Category != category { continue }
		if keyword != "" && !strings.Contains(strings.ToLower(strings.Join([]string{row.Title, row.Description, row.Prompt, row.Category}, " ")), keyword) { continue }
		items = append(items, row)
	}
	sort.Strings(categories)
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1")); size, _ := strconv.Atoi(c.DefaultQuery("pageSize", "20"))
	if page < 1 { page = 1 }; if size < 1 { size = 20 }; if size > 100 { size = 100 }
	total, start := len(items), 0; if page-1 > total/size { start = total } else { start = (page-1)*size }; end := start + size; if end > total { end = total }
	c.JSON(200, gin.H{"items": items[start:end], "categories": categories, "total": total})
}

func (a *App) getPrompt(c *gin.Context) {
	row, err := a.GetPrompt(c.Request.Context(), currentUser(c).ID, c.Param("id"), c.Query("locale")); if err != nil { respondError(c, err); return }; c.JSON(200, row)
}

func (a *App) savePrompt(c *gin.Context) {
	var input promptInput; if !bind(c, &input) { return }
	row, err := a.SavePrompt(currentUser(c).ID, c.Param("id"), input, c.Request.Method == "POST"); if err != nil { respondError(c, err); return }; c.JSON(200, row)
}

func (a *App) deletePrompt(c *gin.Context) {
	var input struct { Version uint64 `json:"version"` }; if !bind(c, &input) { return }
	if err := a.DeletePrompt(currentUser(c).ID, c.Param("id"), input.Version); err != nil { respondError(c, err); return }; c.Status(204)
}
