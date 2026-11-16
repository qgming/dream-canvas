package app

import (
	"crypto/subtle"
	"net"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

const sessionCookie = "dream_canvas_session"

func secureCookie(c *gin.Context) bool {
	if c.Request.TLS != nil { return true }
	host, _, err := net.SplitHostPort(c.Request.RemoteAddr)
	ip := net.ParseIP(host)
	return err == nil && ip != nil && ip.IsLoopback() && c.GetHeader("X-Forwarded-Proto") == "https"
}

func passwordHash(password string) (string, error) {
	if strings.TrimSpace(password) == "" { return "", problem(400, "password_required", "密码不能为空") }
	value, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil { return "", problem(400, "invalid_password", "密码无法保存，请缩短密码后重试") }
	return string(value), nil
}

func (a *App) Initialize(username, password string) error {
	hash, err := passwordHash(password)
	if err != nil { return err }
	username = strings.TrimSpace(username)
	if err := validTitle(username); err != nil { return err }
	return a.db.Transaction(func(tx *gorm.DB) error {
		var count int64
		if err := tx.Model(&User{}).Count(&count).Error; err != nil { return err }
		if count > 0 { return problem(409, "already_initialized", "已有账号，不能重新初始化") }
		return tx.Create(&User{ID: identifier(), Username: username, Password: hash, Role: "admin"}).Error
	})
}

func (a *App) authenticate(c *gin.Context) {
	token, err := c.Cookie(sessionCookie)
	if err != nil { respondError(c, problem(401, "unauthorized", "请先登录")); return }
	var session Session
	var user User
	if a.db.First(&session, "hash = ?", digest(token)).Error != nil || a.db.First(&user, "id = ? AND disabled = ?", session.UserID, false).Error != nil {
		respondError(c, problem(401, "unauthorized", "登录已失效，请重新登录")); return
	}
	if c.Request.Method != "GET" && c.Request.Method != "HEAD" {
		if subtle.ConstantTimeCompare([]byte(c.GetHeader("X-CSRF-Token")), []byte(session.CSRF)) != 1 {
			respondError(c, problem(403, "invalid_csrf", "请刷新页面后重试")); return
		}
	}
	c.Set("user", user)
	c.Set("csrf", session.CSRF)
	c.Set("session", session.Hash)
	c.Next()
}

func (a *App) login(c *gin.Context) {
	var input struct { Username string `json:"username"`; Password string `json:"password"` }
	if !bind(c, &input) { return }
	var user User
	err := a.db.First(&user, "username = ?", strings.TrimSpace(input.Username)).Error
	// Still hash a missing username to avoid a cheap account-existence probe.
	if err != nil { bcrypt.GenerateFromPassword([]byte(input.Password), bcrypt.DefaultCost) }
	if err != nil || user.Disabled || bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(input.Password)) != nil {
		respondError(c, problem(401, "invalid_credentials", "用户名或密码不正确，或账号已停用")); return
	}
	token := identifier()
	session := Session{Hash: digest(token), UserID: user.ID, CSRF: identifier()}
	if err := a.db.Create(&session).Error; err != nil { respondError(c, err); return }
	c.SetSameSite(http.SameSiteStrictMode)
	c.SetCookie(sessionCookie, token, 0, "/", "", secureCookie(c), true)
	c.JSON(200, gin.H{"user": user, "csrf": session.CSRF})
}

func (a *App) logout(c *gin.Context) {
	if err := a.db.Delete(&Session{}, "hash = ?", c.GetString("session")).Error; err != nil { respondError(c, err); return }
	a.notify(currentUser(c).ID)
	c.SetSameSite(http.SameSiteStrictMode)
	c.SetCookie(sessionCookie, "", -1, "/", "", secureCookie(c), true)
	c.Status(204)
}

func (a *App) changePassword(c *gin.Context) {
	var input struct { Current string `json:"currentPassword"`; Password string `json:"password"` }
	if !bind(c, &input) { return }
	user := currentUser(c)
	if bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(input.Current)) != nil { respondError(c, problem(400, "wrong_password", "当前密码不正确")); return }
	if err := a.setPassword(user.ID, input.Password); err != nil { respondError(c, err); return }
	c.Status(204)
}

func (a *App) setPassword(id, password string) error {
	hash, err := passwordHash(password)
	if err != nil { return err }
	err = a.db.Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&User{}).Where("id = ?", id).Update("password", hash)
		if result.Error != nil { return result.Error }
		if result.RowsAffected == 0 { return gorm.ErrRecordNotFound }
		return tx.Delete(&Session{}, "user_id = ?", id).Error
	})
	if err == nil { a.notify(id) }
	return err
}

func (a *App) listUsers(c *gin.Context) {
	users := []User{}
	if err := a.db.Order("created_at").Find(&users).Error; err != nil { respondError(c, err); return }
	c.JSON(200, users)
}

func (a *App) createUser(c *gin.Context) {
	var input struct { Username string `json:"username"`; Password string `json:"password"`; Role string `json:"role"` }
	if !bind(c, &input) { return }
	username := strings.TrimSpace(input.Username)
	if err := validTitle(username); err != nil { respondError(c, err); return }
	if input.Role != "admin" && input.Role != "user" { respondError(c, problem(400, "invalid_role", "请选择管理员或普通用户")); return }
	hash, err := passwordHash(input.Password)
	if err != nil { respondError(c, err); return }
	user := User{ID: identifier(), Username: username, Password: hash, Role: input.Role}
	if err := a.db.Create(&user).Error; err != nil { respondError(c, err); return }
	c.JSON(201, user)
}

func (a *App) updateUser(c *gin.Context) {
	var input struct { Disabled bool `json:"disabled"` }
	if !bind(c, &input) { return }
	if c.Param("id") == currentUser(c).ID && input.Disabled { respondError(c, problem(400, "self_disable", "不能停用当前管理员")); return }
	err := a.db.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := tx.First(&user, "id = ?", c.Param("id")).Error; err != nil { return err }
		if err := tx.Model(&user).Update("disabled", input.Disabled).Error; err != nil { return err }
		if input.Disabled { return tx.Delete(&Session{}, "user_id = ?", user.ID).Error }
		return nil
	})
	if err != nil { respondError(c, err); return }
	a.notify(c.Param("id"))
	c.Status(204)
}

func (a *App) resetPassword(c *gin.Context) {
	var input struct { Password string `json:"password"` }
	if !bind(c, &input) { return }
	if err := a.setPassword(c.Param("id"), input.Password); err != nil { respondError(c, err); return }
	c.Status(204)
}
