package app

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"
)

func TestBlockedIPRejectsSpecialUseAndPrivateAddresses(t *testing.T) {
	blocked := []string{
		"127.0.0.1",
		"10.0.0.1",
		"172.16.0.1",
		"192.168.1.1",
		"169.254.169.254",
		"100.64.0.1",
		"0.0.0.0",
		"192.0.2.1",
		"198.18.0.1",
		"198.51.100.1",
		"203.0.113.1",
		"240.0.0.1",
		"::1",
		"fe80::1",
		"fc00::1",
		"64:ff9b::1",
		"64:ff9b:1::1",
		"100::1",
		"2001:db8::1",
		"::ffff:127.0.0.1",
		"::ffff:100.64.0.1",
	}
	for _, value := range blocked {
		ip := net.ParseIP(value)
		if ip == nil {
			t.Fatalf("failed to parse test ip %q", value)
		}
		if !isBlockedIP(ip) {
			t.Fatalf("expected %s to be blocked", value)
		}
	}
	allowed := []string{
		"1.1.1.1",
		"8.8.8.8",
		"93.184.216.34",
		"2606:2800:220:1:248:1893:25c8:1946",
	}
	for _, value := range allowed {
		ip := net.ParseIP(value)
		if ip == nil {
			t.Fatalf("failed to parse test ip %q", value)
		}
		if isBlockedIP(ip) {
			t.Fatalf("expected public ip %s to be allowed", value)
		}
	}
}

func TestLoginRateLimiterEnforcesAccountLockoutAndIPBurst(t *testing.T) {
	limiter := newLoginRateLimiter()
	for i := 0; i < loginAccountMaxFails; i++ {
		if err := limiter.allow("203.0.113.10", "alice"); err != nil {
			t.Fatalf("attempt %d should be allowed: %v", i, err)
		}
		limiter.recordFailure("alice")
	}
	if err := limiter.allow("203.0.113.11", "alice"); err == nil {
		t.Fatal("expected account lockout after max consecutive failures")
	}
	limiter.clearAccount("alice")
	if err := limiter.allow("203.0.113.11", "alice"); err != nil {
		t.Fatalf("expected account lockout to clear after successful login: %v", err)
	}
	for i := 0; i < loginIPMaxRequests; i++ {
		if err := limiter.allow("198.51.100.20", "user"); err != nil {
			t.Fatalf("ip request %d should be allowed: %v", i, err)
		}
	}
	if err := limiter.allow("198.51.100.20", "other"); err == nil {
		t.Fatal("expected IP rate limit after burst")
	}
}

func TestSessionExpirationAndPasswordChangeRevokesTokens(t *testing.T) {
	a, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()

	hash, err := bcrypt.GenerateFromPassword([]byte("initial-secret-123"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	user := User{ID: identifier(), Username: "tester", Password: string(hash), Role: "user"}
	if err := a.db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}

	expiredToken := identifier()
	if err := a.db.Create(&Session{
		Hash:      digest(expiredToken),
		UserID:    user.ID,
		CSRF:      identifier(),
		ExpiresAt: time.Now().Add(-time.Minute),
	}).Error; err != nil {
		t.Fatal(err)
	}
	router := a.Router("", "")
	req := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	req.AddCookie(&http.Cookie{Name: sessionCookie, Value: expiredToken})
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expired session returned %d, want 401", rec.Code)
	}
	var sessionCount int64
	if err := a.db.Model(&Session{}).Where("hash = ?", digest(expiredToken)).Count(&sessionCount).Error; err != nil {
		t.Fatal(err)
	}
	if sessionCount != 0 {
		t.Fatalf("expired session should be purged on authentication, found %d", sessionCount)
	}

	activeToken := identifier()
	if err := a.db.Create(&Session{
		Hash:      digest(activeToken),
		UserID:    user.ID,
		CSRF:      identifier(),
		ExpiresAt: time.Now().Add(time.Hour),
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := a.db.Create(&AccessToken{
		ID:       identifier(),
		UserID:   user.ID,
		Name:     "mcp-token",
		Hash:     digest("dc_test_secret"),
		Scopes:   encode([]string{"read"}),
		Projects: encode([]string{}),
	}).Error; err != nil {
		t.Fatal(err)
	}

	if err := a.setPassword(user.ID, "rotated-secret-456"); err != nil {
		t.Fatal(err)
	}
	var remainingSessions, remainingTokens int64
	a.db.Model(&Session{}).Where("user_id = ?", user.ID).Count(&remainingSessions)
	a.db.Model(&AccessToken{}).Where("user_id = ?", user.ID).Count(&remainingTokens)
	if remainingSessions != 0 || remainingTokens != 0 {
		t.Fatalf("setPassword must revoke all sessions and access tokens, got sessions=%d tokens=%d", remainingSessions, remainingTokens)
	}
}

func TestSSESubscribeLimitAndClientQuota(t *testing.T) {
	a, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()

	stops := make([]func(), 0, maxUserSSEStreams)
	for i := 0; i < maxUserSSEStreams; i++ {
		_, stop, err := a.subscribe("user-1")
		if err != nil {
			t.Fatalf("subscribe %d failed: %v", i, err)
		}
		stops = append(stops, stop)
	}
	if _, _, err := a.subscribe("user-1"); err == nil {
		t.Fatal("expected subscribe to reject stream exceeding maxUserSSEStreams")
	}
	stops[0]()
	_, stop, err := a.subscribe("user-1")
	if err != nil {
		t.Fatalf("expected subscribe to succeed after releasing one stream: %v", err)
	}
	stop()
	for _, fn := range stops[1:] {
		fn()
	}
}

func TestJSONLimitAppliesToStructuredJSONContentTypes(t *testing.T) {
	a, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()

	policy := suggestedPolicy()
	policy.JSONBytes = 128
	if err := a.db.Save(&RuntimeSettings{ID: 1, Policy: encode(policy)}).Error; err != nil {
		t.Fatal(err)
	}
	a.invalidatePolicyCache()

	router := a.Router("", "")
	payload := `{"username":"` + strings.Repeat("a", 512) + `","password":"x"}`
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewBufferString(payload))
	req.Header.Set("Content-Type", "application/merge-patch+json; charset=utf-8")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code == http.StatusOK {
		t.Fatalf("expected oversized +json request to be rejected, got 200")
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("expected JSON error body, got %q", rec.Body.String())
	}
	if rec.Code != http.StatusBadRequest && rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected 400 or 413 for oversized +json body, got %d (%v)", rec.Code, body)
	}
}

func TestPersistProviderResponseEnforcesCapAndPolicyCacheInvalidates(t *testing.T) {
	a, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()

	policy, err := a.executionPolicy()
	if err != nil {
		t.Fatal(err)
	}
	if policy.VideoBytes != 4<<30 {
		t.Fatalf("expected default VideoBytes to be 4 GiB, got %d", policy.VideoBytes)
	}
	updated := policy
	updated.JSONBytes = 16 << 20
	if err := a.db.Save(&RuntimeSettings{ID: 1, Policy: encode(updated)}).Error; err != nil {
		t.Fatal(err)
	}
	a.invalidatePolicyCache()
	reloaded, err := a.executionPolicy()
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.JSONBytes != 16<<20 {
		t.Fatalf("expected invalidated policy cache to reload JSONBytes=16MiB, got %d", reloaded.JSONBytes)
	}

	// Verify watchedBody Close is idempotent and safe under concurrent Read/Close.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	wb := &watchedBody{
		ReadCloser: io.NopCloser(strings.NewReader("hello")),
		timer:      time.AfterFunc(time.Minute, cancel),
		idle:       time.Minute,
		cancel:     cancel,
	}
	buf := make([]byte, 5)
	n, readErr := wb.Read(buf)
	if readErr != nil || n != 5 {
		t.Fatalf("watchedBody.Read failed: n=%d err=%v", n, readErr)
	}
	if err := wb.Close(); err != nil {
		t.Fatalf("first watchedBody.Close failed: %v", err)
	}
	if err := wb.Close(); err != nil {
		t.Fatalf("second watchedBody.Close failed: %v", err)
	}
	if ctx.Err() == nil {
		t.Fatal("expected watchedBody.Close to cancel context")
	}

	// Verify persistProviderResponse enforces maxProviderResponseBytes (streaming zero reader, no large RAM allocation).
	oversized := io.NopCloser(io.LimitReader(zeroReader{}, maxProviderResponseBytes+1024))
	_, err = a.persistProviderResponse("oversized-test", oversized)
	var prob *Problem
	if !errors.As(err, &prob) || prob.Code != "provider_response_too_large" {
		t.Fatalf("expected provider_response_too_large, got %v", err)
	}
}

type zeroReader struct{}

func (zeroReader) Read(p []byte) (int, error) {
	clear(p)
	return len(p), nil
}

func TestEndToEndLoginWorkbenchEnforcementAndAssetCache304(t *testing.T) {
	a, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	if err := a.Initialize("admin", "AdminPass123!"); err != nil {
		t.Fatal(err)
	}
	router := a.Router("", "")

	// 1. Login and capture cookie + CSRF
	loginReq := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(`{"username":"admin","password":"AdminPass123!"}`))
	loginReq.Header.Set("Content-Type", "application/json")
	loginRec := httptest.NewRecorder()
	router.ServeHTTP(loginRec, loginReq)
	if loginRec.Code != http.StatusOK {
		t.Fatalf("login failed: %d %s", loginRec.Code, loginRec.Body.String())
	}
	var loginResp struct {
		CSRF string `json:"csrf"`
	}
	if err := json.Unmarshal(loginRec.Body.Bytes(), &loginResp); err != nil || loginResp.CSRF == "" {
		t.Fatalf("missing csrf token in login response: %s", loginRec.Body.String())
	}
	cookies := loginRec.Result().Cookies()
	addAuth := func(req *http.Request) {
		for _, ck := range cookies {
			req.AddCookie(ck)
		}
		if req.Method != http.MethodGet && req.Method != http.MethodHead {
			req.Header.Set("X-CSRF-Token", loginResp.CSRF)
		}
	}

	// 2. Workbench open -> 200; close image workbench -> 403 workbench_closed; video stays 200
	req := httptest.NewRequest(http.MethodGet, "/api/workbench/image/records", nil)
	addAuth(req)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for open image workbench, got %d", rec.Code)
	}

	siteReq := httptest.NewRequest(http.MethodGet, "/api/admin/site", nil)
	addAuth(siteReq)
	siteRec := httptest.NewRecorder()
	router.ServeHTTP(siteRec, siteReq)
	var siteBody struct {
		Version uint64 `json:"version"`
	}
	if err := json.Unmarshal(siteRec.Body.Bytes(), &siteBody); err != nil {
		t.Fatal(err)
	}
	closePayload := map[string]any{
		"version":            siteBody.Version,
		"open":               true,
		"imageWorkbenchOpen": false,
		"videoWorkbenchOpen": true,
		"assistantSlots":     1,
		"generationSlots":    4,
		"userSlots":          2,
	}
	rawClose, _ := json.Marshal(closePayload)
	putReq := httptest.NewRequest(http.MethodPut, "/api/admin/site", bytes.NewReader(rawClose))
	putReq.Header.Set("Content-Type", "application/json")
	addAuth(putReq)
	putRec := httptest.NewRecorder()
	router.ServeHTTP(putRec, putReq)
	if putRec.Code != http.StatusOK {
		t.Fatalf("closing image workbench failed: %d %s", putRec.Code, putRec.Body.String())
	}

	closedReq := httptest.NewRequest(http.MethodGet, "/api/workbench/image/records", nil)
	addAuth(closedReq)
	closedRec := httptest.NewRecorder()
	router.ServeHTTP(closedRec, closedReq)
	if closedRec.Code != http.StatusForbidden || !strings.Contains(closedRec.Body.String(), "workbench_closed") {
		t.Fatalf("expected 403 workbench_closed for closed image workbench, got %d %s", closedRec.Code, closedRec.Body.String())
	}

	videoReq := httptest.NewRequest(http.MethodGet, "/api/workbench/video/records", nil)
	addAuth(videoReq)
	videoRec := httptest.NewRecorder()
	router.ServeHTTP(videoRec, videoReq)
	if videoRec.Code != http.StatusOK {
		t.Fatalf("expected 200 for open video workbench, got %d", videoRec.Code)
	}

	// 3. Upload 1x1 PNG asset (raw body) -> verify Cache-Control, ETag, and 304 Not Modified on file & preview
	pngBytes, err := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=")
	if err != nil {
		t.Fatal(err)
	}
	upReq := httptest.NewRequest(http.MethodPost, "/api/assets?title=smoke", bytes.NewReader(pngBytes))
	upReq.Header.Set("Content-Type", "image/png")
	addAuth(upReq)
	upRec := httptest.NewRecorder()
	router.ServeHTTP(upRec, upReq)
	if upRec.Code != http.StatusCreated && upRec.Code != http.StatusOK {
		t.Fatalf("upload failed: %d %s", upRec.Code, upRec.Body.String())
	}
	var uploaded struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(upRec.Body.Bytes(), &uploaded); err != nil || uploaded.ID == "" {
		t.Fatalf("upload missing asset id: %s", upRec.Body.String())
	}

	for _, suffix := range []string{"/file", "/preview"} {
		getReq := httptest.NewRequest(http.MethodGet, "/api/assets/"+uploaded.ID+suffix, nil)
		addAuth(getReq)
		getRec := httptest.NewRecorder()
		router.ServeHTTP(getRec, getReq)
		if getRec.Code != http.StatusOK {
			t.Fatalf("GET %s failed: %d %s", suffix, getRec.Code, getRec.Body.String())
		}
		if cc := getRec.Header().Get("Cache-Control"); cc != "private, max-age=86400" {
			t.Fatalf("GET %s Cache-Control=%q, want private, max-age=86400", suffix, cc)
		}
		etag := getRec.Header().Get("ETag")
		if etag == "" {
			t.Fatalf("GET %s missing ETag", suffix)
		}
		condReq := httptest.NewRequest(http.MethodGet, "/api/assets/"+uploaded.ID+suffix, nil)
		condReq.Header.Set("If-None-Match", etag)
		addAuth(condReq)
		condRec := httptest.NewRecorder()
		router.ServeHTTP(condRec, condReq)
		if condRec.Code != http.StatusNotModified {
			t.Fatalf("GET %s with If-None-Match=%s returned %d, want 304", suffix, etag, condRec.Code)
		}
	}
}
