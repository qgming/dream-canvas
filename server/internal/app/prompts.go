package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type promptSource struct {
	ID string `json:"id"`
	Name string `json:"name"`
	URL string `json:"url"`
	Homepage string `json:"homepage"`
	Enabled bool `json:"enabled"`
	BuiltIn bool `json:"builtIn"`
}

type PromptCache struct {
	UserID string `json:"-" gorm:"primaryKey"`
	SourceID string `json:"sourceId" gorm:"primaryKey"`
	Signature string `json:"-"`
	Items JSON `json:"items" gorm:"type:blob"`
	Count int `json:"count"`
	LastSuccessAt *time.Time `json:"lastSuccessAt"`
	LastError string `json:"lastError"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func (a *App) promptSources(userID string) ([]promptSource, error) {
	var preference UserPreference
	err := a.db.First(&preference, "user_id = ? AND name = ?", userID, "prompt-sources").Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		ids := []string{"banana-prompt-quicker", "davidwu-gpt-image2-prompts", "freestylefly-gpt-image-2", "awesome-gpt-image", "awesome-gpt4o-image-prompts", "youmind-gpt-image-2", "youmind-nano-banana-pro"}
		names := []string{"Banana Prompt Quicker", "DavidWu GPT Image 2", "Freestylefly GPT Image 2", "Awesome GPT Image", "Awesome GPT-4o", "YouMind GPT Image 2", "YouMind Nano Banana Pro"}
		rows := []promptSource{}; for index, id := range ids { rows = append(rows, promptSource{ID: id, Name: names[index], URL: "https://raw.githubusercontent.com/yukkcat/image-prompts/main/dist/sources/"+id+".json", Homepage: "https://github.com/yukkcat/image-prompts", Enabled: true, BuiltIn: true}) }; return rows, nil
	}
	if err != nil { return nil, err }
	var value struct { Sources []promptSource `json:"sources"` }
	if json.Unmarshal(preference.Value, &value) != nil { return nil, problem(409, "invalid_sources", "提示词来源配置无法读取，未覆盖有效配置") }
	return value.Sources, nil
}

func promptSignature(source promptSource) string { return digest(source.Name+"\n"+source.URL+"\n"+source.Homepage) }

func (a *App) refreshPrompts(ctx context.Context, userID string, source promptSource) (PromptCache, error) {
	a.promptMu.Lock(); defer a.promptMu.Unlock()
	latest, err := a.promptSources(userID); if err != nil { return PromptCache{}, err }
	found := false; for _, current := range latest { if current.ID == source.ID && promptSignature(current) == promptSignature(source) { found = true; break } }; if !found { return PromptCache{}, problem(409, "source_changed", "来源在读取期间已修改，请重新读取") }
	var previous PromptCache
	err = a.db.First(&previous, "user_id = ? AND source_id = ?", userID, source.ID).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) { return previous, err }
	policy, err := a.executionPolicy(); if err != nil { return previous, err }
	release, err := a.acquireFile(ctx, false, false); if err != nil { return previous, err }; defer release()
	ctx, cancel := context.WithTimeout(ctx, seconds(policy.QuerySeconds)); defer cancel()
	fetch := func() ([]map[string]any, error) {
		address, err := url.Parse(source.URL); if err != nil || address.Scheme != "https" || address.Host == "" || address.User != nil { return nil, errors.New("source requires public HTTPS") }
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, source.URL, nil); if err != nil { return nil, err }
		response, err := providerHTTP(policy).Do(request); if err != nil { return nil, err }; defer response.Body.Close()
		if response.StatusCode != http.StatusOK { return nil, errors.New("source rejected request") }
		data, err := io.ReadAll(io.LimitReader(response.Body, policy.JSONBytes+1)); if err != nil || int64(len(data)) > policy.JSONBytes { return nil, errors.New("source exceeds configured JSON limit") }
		var raw []map[string]any; if json.Unmarshal(data, &raw) != nil || raw == nil { return nil, errors.New("source requires array") }
		rows, seen := []map[string]any{}, map[string]bool{}
		absolute := func(value any) string { path := text(value); if path == "" { return "" }; relative, err := url.Parse(path); if err != nil { return "" }; resolved := address.ResolveReference(relative); if resolved.Scheme != "https" && resolved.Scheme != "http" { return "" }; return resolved.String() }
		for index, item := range raw {
			title, prompt := strings.TrimSpace(text(item["title"])), strings.TrimSpace(text(item["prompt"])); if title == "" || prompt == "" { continue }
			id := strings.TrimSpace(text(item["id"])); if id == "" { id = fmt.Sprintf("%s-%04d", source.ID, index+1) }; if seen[id] { continue }; seen[id] = true
			row := map[string]any{"id": id, "title": title, "prompt": prompt, "sourceId": source.ID, "category": source.Name}
			for _, key := range []string{"description", "preview", "createdAt", "updatedAt", "author", "imageMode", "imageModel", "imageSize"} { row[key] = text(item[key]) }
			tags, images := []string{}, []string{}
			for _, tag := range array(item["tags"]) { if tag := strings.TrimSpace(text(tag)); tag != "" { tags = append(tags, tag) } }
			for _, image := range array(item["referenceImageUrls"]) { if address := absolute(image); address != "" { images = append(images, address) } }
			row["tags"], row["referenceImageUrls"], row["coverUrl"], row["sourceUrl"] = tags, images, absolute(item["coverUrl"]), absolute(item["sourceUrl"])
			if row["coverUrl"] == "" && len(images) > 0 { row["coverUrl"] = images[0] }; row["githubUrl"] = row["sourceUrl"]; if row["githubUrl"] == "" { row["githubUrl"] = source.Homepage }
			if count, ok := item["imageCount"].(float64); ok && count > 0 { row["imageCount"] = count }; rows = append(rows, row)
		}
		if source.BuiltIn && len(rows) == 0 { return nil, errors.New("built-in source returned no prompts") }; return rows, nil
	}
	items, fetchErr := fetch()
	latest, err = a.promptSources(userID); if err != nil { return previous, err }; found = false; for _, current := range latest { if current.ID == source.ID && promptSignature(current) == promptSignature(source) { found = true; break } }; if !found { return previous, problem(409, "source_changed", "来源在读取期间已修改，当前结果未写入，请重新读取") }
	row := previous; row.UserID, row.SourceID = userID, source.ID
	if fetchErr != nil { row.LastError = "提示词来源读取失败，请检查来源地址、网络及已配置请求边界；上次成功内容仍保留"; if len(row.Items) == 0 { row.Items = JSON(`[]`) }
	} else { now := time.Now(); row.Items, row.Count, row.LastSuccessAt, row.LastError, row.Signature = encode(items), len(items), &now, "", promptSignature(source) }
	row.UpdatedAt = time.Now()
	if err := a.db.Clauses(clause.OnConflict{UpdateAll: true}).Create(&row).Error; err != nil { return row, err }
	a.notifyTopic(userID, "prompts")
	if fetchErr != nil { return row, problem(502, "prompt_source_failed", row.LastError) }; return row, nil
}

// The saved refresh interval applies even while all browser pages are closed.
func (a *App) dispatchPromptRefresh() {
	a.workMu.Lock(); active := a.active["prompts"] != nil; a.workMu.Unlock(); if active { return }
	users := []User{}; if a.db.Where("disabled = ?", false).Order("created_at").Find(&users).Error != nil { return }
	type dueSource struct { userID string; source promptSource; updated time.Time }; due := []dueSource{}
	for _, user := range users {
		interval := 30
		var preference UserPreference; err := a.db.First(&preference, "user_id = ? AND name = ?", user.ID, "prompt-sources").Error
		if err == nil { var value struct { Schedule struct { Interval int `json:"intervalMinutes"` } `json:"schedule"` }; if json.Unmarshal(preference.Value, &value) != nil { continue }; interval = value.Schedule.Interval } else if !errors.Is(err, gorm.ErrRecordNotFound) { continue }
		if !includes([]string{"30", "60", "360", "1440"}, fmt.Sprint(interval)) { continue }
		sources, err := a.promptSources(user.ID); if err != nil { continue }
		for _, source := range sources {
			if !source.Enabled { continue }; var cache PromptCache; err := a.db.First(&cache, "user_id = ? AND source_id = ?", user.ID, source.ID).Error
			if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) { continue }
			if errors.Is(err, gorm.ErrRecordNotFound) || cache.Signature != promptSignature(source) && cache.LastError == "" || time.Since(cache.UpdatedAt) >= time.Duration(interval)*time.Minute { due = append(due, dueSource{user.ID, source, cache.UpdatedAt}) }
		}
	}
	if len(due) == 0 { return }; sort.Slice(due, func(i, j int) bool { return due[i].updated.Before(due[j].updated) }); next := due[0]
	a.launch("prompts", func(ctx context.Context) { _, _ = a.refreshPrompts(ctx, next.userID, next.source) })
}

func (a *App) sourcePrompts(ctx context.Context, userID, sourceID string, refresh bool) (PromptCache, error) {
	sources, err := a.promptSources(userID); if err != nil { return PromptCache{}, err }
	for _, source := range sources { if source.ID != sourceID { continue }; var cache PromptCache
		err := a.db.First(&cache, "user_id = ? AND source_id = ?", userID, source.ID).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) { return cache, err }
		if refresh || errors.Is(err, gorm.ErrRecordNotFound) || cache.Signature != promptSignature(source) { return a.refreshPrompts(ctx, userID, source) }; return cache, nil
	}; return PromptCache{}, problem(404, "source_missing", "来源不存在，请先保存来源配置")
}

func (a *App) getSourcePrompts(c *gin.Context) {
	row, err := a.sourcePrompts(c.Request.Context(), currentUser(c).ID, c.Param("id"), c.Request.Method == "POST")
	if err != nil { respondError(c, err); return }; c.JSON(200, row)
}

func (a *App) promptStatuses(c *gin.Context) {
	rows := []PromptCache{}; if err := a.db.Where("user_id = ?", currentUser(c).ID).Omit("items", "signature").Find(&rows).Error; err != nil { respondError(c, err); return }; c.JSON(200, rows)
}

func (a *App) ListPrompts(ctx context.Context, userID string) ([]map[string]any, error) {
	sources, err := a.promptSources(userID); if err != nil { return nil, err }
	items := []map[string]any{}
	for _, source := range sources { if !source.Enabled { continue }; cache, err := a.sourcePrompts(ctx, userID, source.ID, false); if err != nil { return nil, err }; var rows []map[string]any; if json.Unmarshal(cache.Items, &rows) != nil { return nil, problem(409, "invalid_prompt_cache", "提示词内容无法读取，请主动刷新来源") }; items = append(items, rows...) }; return items, nil
}
