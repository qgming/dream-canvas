package app

import (
	"context"
	"crypto/subtle"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

const (
	sessionCookie          = "dream_canvas_session"
	sessionTTL             = 30 * 24 * time.Hour
	loginIPWindow          = time.Minute
	loginIPMaxRequests     = 20
	loginAccountMaxFails   = 5
	loginAccountLockout    = 5 * time.Minute
	loginBcryptWaitTimeout = 5 * time.Second
)

type loginAccountState struct {
	fails     int
	lockUntil time.Time
	lastSeen  time.Time
}

type loginRateLimiter struct {
	mu       sync.Mutex
	ips      map[string][]time.Time
	accounts map[string]loginAccountState
	lastTrim time.Time
}

func newLoginRateLimiter() *loginRateLimiter {
	return &loginRateLimiter{ips: map[string][]time.Time{}, accounts: map[string]loginAccountState{}}
}

func (l *loginRateLimiter) trimLocked(now time.Time) {
	if now.Sub(l.lastTrim) < time.Minute { return }
	l.lastTrim = now
	cutoff := now.Add(-loginIPWindow)
	for ip, stamps := range l.ips {
		kept := stamps[:0]
		for _, ts := range stamps { if ts.After(cutoff) { kept = append(kept, ts) } }
		if len(kept) == 0 { delete(l.ips, ip) } else { l.ips[ip] = kept }
	}
	for user, state := range l.accounts {
		if !state.lockUntil.After(now) && now.Sub(state.lastSeen) > loginAccountLockout*2 { delete(l.accounts, user) }
	}
}

func (l *loginRateLimiter) allow(ip, username string) error {
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()
	l.trimLocked(now)
	cutoff := now.Add(-loginIPWindow)
	stamps := l.ips[ip][:0]
	for _, ts := range l.ips[ip] { if ts.After(cutoff) { stamps = append(stamps, ts) } }
	if len(stamps) >= loginIPMaxRequests {
		l.ips[ip] = stamps
		return problem(429, "rate_limited", "登录请求过于频繁，请稍后再试")
	}
	l.ips[ip] = append(stamps, now)
	if username != "" {
		if state, ok := l.accounts[username]; ok && state.lockUntil.After(now) {
			return problem(429, "account_locked", "该账号连续登录失败次数过多，请 5 分钟后再试")
		}
	}
	return nil
}

func (l *loginRateLimiter) recordFailure(username string) {
	if username == "" { return }
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()
	state := l.accounts[username]
	if !state.lockUntil.IsZero() && !state.lockUntil.After(now) { state.fails = 0; state.lockUntil = time.Time{} }
	state.fails++
	state.lastSeen = now
	if state.fails >= loginAccountMaxFails { state.lockUntil = now.Add(loginAccountLockout); state.fails = 0 }
	l.accounts[username] = state
}

func (l *loginRateLimiter) clearAccount(username string) {
	if username == "" { return }
	l.mu.Lock()
	delete(l.accounts, username)
	l.mu.Unlock()
}

func (a *App) acquireBcrypt(ctx context.Context) (func(), error) {
	if a.bcryptGate == nil { return func() {}, nil }
	timer := time.NewTimer(loginBcryptWaitTimeout)
	defer timer.Stop()
	select {
	case a.bcryptGate <- struct{}{}:
		return func() { <-a.bcryptGate }, nil
	case <-timer.C:
		return nil, problem(429, "auth_busy", "当前登录验证繁忙，请稍后重试")
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func clearSessionCookie(c *gin.Context) {
	c.SetSameSite(http.SameSiteStrictMode)
	c.SetCookie(sessionCookie, "", -1, "/", "", secureCookie(c), true)
}

func (a *App) missingSession(c *gin.Context) {
	clearSessionCookie(c)
	if err := a.siteAccess(User{}); err != nil { respondError(c, err); return }
	respondError(c, problem(401, "unauthorized", "登录已失效，请重新登录"))
}

func secureCookie(c *gin.Context) bool {
	if c.Request.TLS != nil { return true }
	return c.GetBool("trustedProxy") && c.GetHeader("X-Forwarded-Proto") == "https"
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
	if header := c.GetHeader("Authorization"); strings.HasPrefix(header, "Bearer ") {
		principal, err := a.tokenPrincipal(strings.TrimPrefix(header, "Bearer ")); if err != nil { respondError(c, err); return }
		scope := "read"; if c.Request.Method != "GET" && c.Request.Method != "HEAD" { scope = "edit" }
		if !principal.allows(scope, "") { respondError(c, problem(403, "forbidden", "访问令牌不允许此操作")); return }
		path := c.FullPath()
		if path == "/api/assets" && c.Request.Method == "POST" { if len(principal.Projects) > 0 { respondError(c, problem(403, "asset_scope", "上传全局资产需要不限项目的令牌")); return }
		} else if (path == "/api/assets/:id/file" || path == "/api/assets/:id/preview") && scope == "read" {
			if err := a.checkTokenAsset(principal, c.Param("id")); err != nil { respondError(c, err); return }
		} else { respondError(c, problem(403, "token_route", "此 HTTP 入口不接受访问令牌，请使用远程 MCP 业务工具")); return }
		c.Set("user", principal.User); c.Next(); return
	}
	token, err := c.Cookie(sessionCookie)
	if err != nil { a.missingSession(c); return }
	var session Session
	var user User
	if a.db.First(&session, "hash = ?", digest(token)).Error != nil {
		a.missingSession(c); return
	}
	if session.ExpiresAt.IsZero() || !session.ExpiresAt.After(time.Now()) {
		_ = a.db.Delete(&Session{}, "hash = ?", session.Hash).Error
		a.missingSession(c); return
	}
	if a.db.First(&user, "id = ? AND disabled = ?", session.UserID, false).Error != nil {
		a.missingSession(c); return
	}
	if err := a.siteAccess(user); err != nil { clearSessionCookie(c); respondError(c, err); return }
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
	username := strings.TrimSpace(input.Username)
	if a.loginLimiter != nil {
		if err := a.loginLimiter.allow(c.ClientIP(), strings.ToLower(username)); err != nil { respondError(c, err); return }
	}
	release, err := a.acquireBcrypt(c.Request.Context())
	if err != nil { respondError(c, err); return }
	var user User
	err = a.db.First(&user, "username = ?", username).Error
	// Still hash a missing username to avoid a cheap account-existence probe.
	var hashErr error
	if err != nil {
		_, _ = bcrypt.GenerateFromPassword([]byte(input.Password), bcrypt.DefaultCost)
	} else {
		hashErr = bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(input.Password))
	}
	release()
	if err != nil || user.Disabled || hashErr != nil {
		if a.loginLimiter != nil { a.loginLimiter.recordFailure(strings.ToLower(username)) }
		respondError(c, problem(401, "invalid_credentials", "用户名或密码不正确，或账号已停用")); return
	}
	if a.loginLimiter != nil { a.loginLimiter.clearAccount(strings.ToLower(username)) }
	token := identifier()
	expiresAt := time.Now().Add(sessionTTL)
	session := Session{Hash: digest(token), UserID: user.ID, CSRF: identifier(), ExpiresAt: expiresAt}
	err = a.db.Transaction(func(tx *gorm.DB) error {
		if user.Role != "admin" {
			var record RuntimeSettings
			if err := tx.Select("site_closed").First(&record, 1).Error; err != nil && err != gorm.ErrRecordNotFound { return err }
			if record.SiteClosed { return problem(503, "site_closed", "梦想画布已关闭") }
		}
		return tx.Create(&session).Error
	})
	if err != nil { clearSessionCookie(c); respondError(c, err); return }
	c.SetSameSite(http.SameSiteStrictMode)
	c.SetCookie(sessionCookie, token, int(sessionTTL.Seconds()), "/", "", secureCookie(c), true)
	c.JSON(200, gin.H{"user": user, "csrf": session.CSRF})
}

func (a *App) logout(c *gin.Context) {
	if err := a.db.Delete(&Session{}, "hash = ?", c.GetString("session")).Error; err != nil { respondError(c, err); return }
	a.notify(currentUser(c).ID)
	clearSessionCookie(c)
	c.Status(204)
}

func (a *App) changePassword(c *gin.Context) {
	var input struct { Current string `json:"currentPassword"`; Password string `json:"password"` }
	if !bind(c, &input) { return }
	if err := a.ChangePassword(currentUser(c), input.Current, input.Password); err != nil { respondError(c, err); return }
	c.Status(204)
}

func (a *App) ChangePassword(user User, current, password string) error {
	if bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(current)) != nil { return problem(400, "wrong_password", "当前密码不正确") }; return a.setPassword(user.ID, password)
}

func (a *App) setPassword(id, password string) error {
	hash, err := passwordHash(password)
	if err != nil { return err }
	err = a.db.Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&User{}).Where("id = ?", id).Update("password", hash)
		if result.Error != nil { return result.Error }
		if result.RowsAffected == 0 { return gorm.ErrRecordNotFound }
		if err := tx.Delete(&Session{}, "user_id = ?", id).Error; err != nil { return err }
		return tx.Delete(&AccessToken{}, "user_id = ?", id).Error
	})
	if err == nil { a.notify(id) }
	return err
}

func (a *App) listUsers(c *gin.Context) {
	users := []User{}
	if err := a.db.Order("created_at").Find(&users).Error; err != nil { respondError(c, err); return }
	c.JSON(200, users)
}

type userInput struct { Username string `json:"username"`; Password string `json:"password"`; Role string `json:"role"` }

func (a *App) createUser(c *gin.Context) {
	var input userInput; if !bind(c, &input) { return }; user, err := a.CreateUser(input); if err != nil { respondError(c, err); return }; c.JSON(201, user)
}

func (a *App) CreateUser(input userInput) (User, error) {
	username := strings.TrimSpace(input.Username)
	if err := validTitle(username); err != nil { return User{}, err }
	if input.Role != "admin" && input.Role != "user" { return User{}, problem(400, "invalid_role", "请选择管理员或普通用户") }
	hash, err := passwordHash(input.Password)
	if err != nil { return User{}, err }
	user := User{ID: identifier(), Username: username, Password: hash, Role: input.Role}
	err = a.db.Create(&user).Error; return user, err
}

func (a *App) updateUser(c *gin.Context) {
	var input struct { Disabled bool `json:"disabled"` }
	if !bind(c, &input) { return }
	if err := a.SetUserDisabled(currentUser(c).ID, c.Param("id"), input.Disabled); err != nil { respondError(c, err); return }; c.Status(204)
}

func (a *App) SetUserDisabled(adminID, userID string, disabled bool) error {
	if userID == adminID && disabled { return problem(400, "self_disable", "不能停用当前管理员") }
	err := a.db.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := tx.First(&user, "id = ?", userID).Error; err != nil { return err }
		if err := tx.Model(&user).Update("disabled", disabled).Error; err != nil { return err }
		if disabled { return tx.Delete(&Session{}, "user_id = ?", user.ID).Error }
		return nil
	})
	if err == nil { a.notify(userID) }; return err
}

func (a *App) resetPassword(c *gin.Context) {
	var input struct { Password string `json:"password"` }
	if !bind(c, &input) { return }
	if err := a.setPassword(c.Param("id"), input.Password); err != nil { respondError(c, err); return }
	c.Status(204)
}
