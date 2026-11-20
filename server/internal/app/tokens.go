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
	FixedProject bool
	TargetProjectID string
	ClientID string
}

func includes(values []string, value string) bool { for _, entry := range values { if entry == value { return true } }; return false }

func (p Principal) allows(scope, project string) bool {
	if !includes(p.Scopes, scope) { return false }
	if scope == "admin" && p.User.Role != "admin" { return false }
	if includes([]string{"account", "assistant", "admin"}, scope) && len(p.Projects) > 0 { return false }
	if p.FixedProject && project != "" && project != p.TargetProjectID { return false }
	return project == "" || len(p.Projects) == 0 || includes(p.Projects, project)
}

func (a *App) tokenPrincipal(raw string) (Principal, error) {
	var principal Principal
	if raw == "" { return principal, problem(401, "token_required", "需要有效的 Bearer Token") }
	if err := a.db.First(&principal.Token, "hash = ? AND revoked = ?", digest(raw), false).Error; err != nil { return principal, problem(401, "invalid_token", "访问令牌无效或已撤销") }
	if err := a.db.First(&principal.User, "id = ? AND disabled = ?", principal.Token.UserID, false).Error; err != nil { return principal, problem(401, "invalid_token", "账号不存在或已停用") }
	if err := a.siteAccess(principal.User); err != nil { return principal, err }
	if json.Unmarshal(principal.Token.Scopes, &principal.Scopes) != nil || json.Unmarshal(principal.Token.Projects, &principal.Projects) != nil { return principal, problem(403, "invalid_scope", "令牌授权范围无效") }
	return principal, nil
}

func (a *App) listTokens(c *gin.Context) {
	tokens := []AccessToken{}
	if err := a.db.Where("user_id = ?", currentUser(c).ID).Order("created_at DESC").Find(&tokens).Error; err != nil { respondError(c, err); return }
	c.JSON(200, tokens)
}

type tokenInput struct { Name string `json:"name"`; Scopes []string `json:"scopes"`; Projects []string `json:"projects"` }

func (a *App) createToken(c *gin.Context) {
	var input tokenInput; if !bind(c, &input) { return }; value, err := a.CreateToken(currentUser(c), input); if err != nil { respondError(c, err); return }; c.JSON(201, value)
}

func (a *App) CreateToken(user User, input tokenInput) (gin.H, error) {
	if err := validTitle(input.Name); err != nil { return nil, err }
	if len(input.Scopes) == 0 { return nil, problem(400, "scope_required", "至少选择一项操作权限") }
	for _, scope := range input.Scopes {
		if !includes([]string{"read", "edit", "generate", "delete", "assistant", "account", "admin"}, scope) { return nil, problem(400, "invalid_scope", "不支持的令牌操作权限") }
		if scope == "admin" && user.Role != "admin" { return nil, problem(403, "forbidden", "只有管理员可以授权管理配置") }
		if len(input.Projects) > 0 && includes([]string{"assistant", "account", "admin"}, scope) { return nil, problem(400, "global_scope", "助手会话、账号及管理员配置权限需要不限项目的令牌") }
	}
	for _, id := range input.Projects {
		var project Project
		if err := a.db.First(&project, "id = ? AND user_id = ?", id, user.ID).Error; err != nil { return nil, err }
	}
	if input.Projects == nil { input.Projects = []string{} }
	scopes, _ := json.Marshal(input.Scopes)
	projects, _ := json.Marshal(input.Projects)
	raw := "dc_" + identifier()
	token := AccessToken{ID: identifier(), UserID: user.ID, Name: strings.TrimSpace(input.Name), Hash: digest(raw), Scopes: scopes, Projects: projects}
	if err := a.db.Create(&token).Error; err != nil { return nil, err }; return gin.H{"token": raw, "record": token}, nil
}

func (a *App) revokeToken(c *gin.Context) {
	if err := a.RevokeToken(currentUser(c).ID, c.Param("id")); err != nil { respondError(c, err); return }
	c.Status(204)
}

func (a *App) RevokeToken(userID, id string) error {
	result := a.db.Model(&AccessToken{}).Where("id = ? AND user_id = ?", id, userID).Update("revoked", true)
	if result.Error != nil { return result.Error }; if result.RowsAffected == 0 { return problem(404, "not_found", "访问令牌不存在") }; return nil
}
