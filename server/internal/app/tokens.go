package app

import (
	"encoding/json"
	"strings"

	"github.com/gin-gonic/gin"
)

type Principal struct {
	User User
	Token AccessToken
	Scopes []string
	Projects []string
}

func includes(values []string, value string) bool { for _, entry := range values { if entry == value { return true } }; return false }

func (p Principal) allows(scope, project string) bool {
	if !includes(p.Scopes, scope) { return false }
	return project == "" || len(p.Projects) == 0 || includes(p.Projects, project)
}

func (a *App) tokenPrincipal(raw string) (Principal, error) {
	var principal Principal
	if raw == "" { return principal, problem(401, "token_required", "需要有效的 Bearer Token") }
	if err := a.db.First(&principal.Token, "hash = ? AND revoked = ?", digest(raw), false).Error; err != nil { return principal, problem(401, "invalid_token", "访问令牌无效或已撤销") }
	if err := a.db.First(&principal.User, "id = ? AND disabled = ?", principal.Token.UserID, false).Error; err != nil { return principal, problem(401, "invalid_token", "账号不存在或已停用") }
	if json.Unmarshal(principal.Token.Scopes, &principal.Scopes) != nil || json.Unmarshal(principal.Token.Projects, &principal.Projects) != nil { return principal, problem(403, "invalid_scope", "令牌授权范围无效") }
	return principal, nil
}

func (a *App) listTokens(c *gin.Context) {
	tokens := []AccessToken{}
	if err := a.db.Where("user_id = ?", currentUser(c).ID).Order("created_at DESC").Find(&tokens).Error; err != nil { respondError(c, err); return }
	c.JSON(200, tokens)
}

func (a *App) createToken(c *gin.Context) {
	var input struct { Name string `json:"name"`; Scopes []string `json:"scopes"`; Projects []string `json:"projects"` }
	if !bind(c, &input) { return }
	if err := validTitle(input.Name); err != nil { respondError(c, err); return }
	if len(input.Scopes) == 0 { respondError(c, problem(400, "scope_required", "至少选择一项操作权限")); return }
	for _, scope := range input.Scopes {
		if scope != "read" && scope != "edit" && scope != "delete" { respondError(c, problem(400, "invalid_scope", "目前支持读取、编辑和申请删除权限")); return }
	}
	for _, id := range input.Projects {
		var project Project
		if err := a.db.First(&project, "id = ? AND user_id = ?", id, currentUser(c).ID).Error; err != nil { respondError(c, err); return }
	}
	if input.Projects == nil { input.Projects = []string{} }
	scopes, _ := json.Marshal(input.Scopes)
	projects, _ := json.Marshal(input.Projects)
	raw := "dc_" + identifier()
	token := AccessToken{ID: identifier(), UserID: currentUser(c).ID, Name: strings.TrimSpace(input.Name), Hash: digest(raw), Scopes: scopes, Projects: projects}
	if err := a.db.Create(&token).Error; err != nil { respondError(c, err); return }
	c.JSON(201, gin.H{"token": raw, "record": token})
}

func (a *App) revokeToken(c *gin.Context) {
	result := a.db.Model(&AccessToken{}).Where("id = ? AND user_id = ?", c.Param("id"), currentUser(c).ID).Update("revoked", true)
	if result.Error != nil { respondError(c, result.Error); return }
	if result.RowsAffected == 0 { respondError(c, problem(404, "not_found", "访问令牌不存在")); return }
	c.Status(204)
}
