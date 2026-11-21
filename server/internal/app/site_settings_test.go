package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func siteTestApp(t *testing.T) *App {
	t.Helper()
	a := assetFileTestApp(t)
	if err := a.db.AutoMigrate(&Session{}, &AccessToken{}); err != nil { t.Fatal(err) }
	if err := a.db.Model(&User{}).Where("id = ?", "owner").Update("role", "user").Error; err != nil { t.Fatal(err) }
	hash, err := passwordHash("site-test-password"); if err != nil { t.Fatal(err) }
	if err := a.db.Model(&User{}).Where("id = ?", "owner").Update("password", hash).Error; err != nil { t.Fatal(err) }
	if err := a.db.Create(&User{ID: "admin", Username: "admin", Role: "admin", Password: hash}).Error; err != nil { t.Fatal(err) }
	return a
}

func requireSiteError(t *testing.T, err error, code string) {
	t.Helper()
	var failure *Problem
	if !errors.As(err, &failure) || failure.Code != code { t.Fatalf("expected %s, got %v", code, err) }
}

func TestSiteDefaultsOpenAndKeepsExecutionBounds(t *testing.T) {
	a := siteTestApp(t)
	if err := a.db.Delete(&RuntimeSettings{}, 1).Error; err != nil { t.Fatal(err) }
	settings, err := a.GetSiteSettings(); if err != nil { t.Fatal(err) }
	if !settings.Open || settings.Version != 0 || settings.AssistantSlots != 1 || settings.GenerationSlots != 4 || settings.UserSlots != 2 { t.Fatalf("unexpected initial settings: %+v", settings) }
	if _, err := a.requireExecution(); err != nil { t.Fatalf("new installations require a separate execution switch: %v", err) }
	open := true
	saved, err := a.SaveSiteSettings("admin", siteSettingsInput{Open: &open, AssistantSlots: 2, GenerationSlots: 6, UserSlots: 3}); if err != nil { t.Fatal(err) }
	if saved.Version != 1 || !saved.Open { t.Fatalf("invalid saved settings: %+v", saved) }
	policy, err := a.executionPolicy(); if err != nil { t.Fatal(err) }
	if policy.GenerationSlots != 6 || policy.ConnectSeconds != suggestedPolicy().ConnectSeconds { t.Fatal("concurrency changed unrelated bounds") }
	policy.QuerySeconds = 87
	if err := a.db.Model(&RuntimeSettings{}).Where("id = ?", 1).Update("policy", encode(policy)).Error; err != nil { t.Fatal(err) }
	if _, err := a.SaveSiteSettings("admin", siteSettingsInput{Version: 1, Open: &open, AssistantSlots: 2, GenerationSlots: 7, UserSlots: 3}); err != nil { t.Fatal(err) }
	policy, err = a.executionPolicy(); if err != nil || policy.QuerySeconds != 87 { t.Fatal("saving site settings replaced persisted server bounds") }
}

func TestSiteScriptRuntimeSaveSharesValidationAndVersionAcrossEntries(t *testing.T) {
	a := siteTestApp(t)
	old := suggestedPolicy()
	old.ScriptRuntime, old.ScriptSeconds, old.ScriptMemoryMiB = nil, 5, 64
	if err := a.db.Model(&RuntimeSettings{}).Where("id = ?", 1).Update("policy", encode(old)).Error; err != nil { t.Fatal(err) }
	admin := Principal{User: User{ID: "admin", Role: "admin"}, Scopes: []string{"admin"}}
	ctx := context.Background()
	current, err := a.GetSiteSettings(); if err != nil { t.Fatal(err) }
	if current.ScriptRuntime[scriptInitSeconds] != 25 || current.ScriptRuntimeBounds[scriptMemoryMiB].Default != 128 || old.scriptJSONBytes() != 8<<20 { t.Fatalf("unexpected defaults for new work or changed snapshot: %+v", current) }
	call := func(p Principal, input map[string]any) (any, error) { return a.CallBusiness(ctx, p, "admin_script_runtime_save", input) }
	input := map[string]any{"version": float64(current.Version), "scriptRuntime": map[string]any{"submitSeconds": 24, "jsonLimitMiB": 20}}
	_, err = call(Principal{User: admin.User, Scopes: []string{"admin"}, Projects: []string{"project"}}, input); requireSiteError(t, err, "forbidden")
	_, err = call(Principal{User: User{ID: "owner"}, Scopes: []string{"admin"}}, input); requireSiteError(t, err, "forbidden")
	_, err = call(Principal{User: admin.User, Scopes: []string{"read"}}, input); requireSiteError(t, err, "forbidden")
	input["open"] = false
	_, err = call(admin, input); requireSiteError(t, err, "invalid_script_runtime")
	delete(input, "open")
	updates, stop := a.subscribe(admin.User.ID); defer stop()
	mcpResult, err := call(admin, input); if err != nil { t.Fatal(err) }
	saved := mcpResult.(siteSettings)
	select { case <-updates: default: t.Fatal("web settings readers did not receive a change event") }
	if !saved.Open || saved.Version != current.Version+1 || saved.AssistantSlots != current.AssistantSlots || saved.ScriptRuntime[scriptSubmitSeconds] != 24 || saved.ScriptRuntime[scriptJSONMiB] != 20 || saved.ScriptRuntime[scriptInitSeconds] != 25 { t.Fatalf("patch changed unrelated settings or was not applied: %+v", saved) }
	_, err = call(admin, input); requireSiteError(t, err, "version_conflict")
	assistant := admin; assistant.FixedProject = true
	allowed := map[string]bool{}
	for _, tool := range assistantTools(assistant) { allowed[text(object(tool["function"])["name"])] = true }
	if !allowed["admin_script_runtime_save"] || allowed["admin_site_save"] { t.Fatal("assistant runtime tool permissions are incorrect") }
	_, err = a.CallBusiness(ctx, assistant, "admin_site_save", map[string]any{}); requireSiteError(t, err, "direct_user_action")
	input["version"], input["scriptRuntime"] = float64(saved.Version), map[string]any{"memoryMiB": 257}
	_, err = call(assistant, input); requireSiteError(t, err, "invalid_script_runtime")
	input["scriptRuntime"] = map[string]any{"memoryMiB": 96}
	updated, err := call(assistant, input); if err != nil { t.Fatal(err) }
	settings := updated.(siteSettings)
	open := true
	webPatch := scriptRuntimeSettings{scriptResultSeconds: 19}
	if _, err := a.SaveSiteSettings(admin.User.ID, siteSettingsInput{Version: settings.Version, Open: &open, AssistantSlots: 1, GenerationSlots: 4, UserSlots: 2, ScriptRuntime: &webPatch}); err != nil { t.Fatal(err) }
	policy, err := a.requireExecution(); if err != nil { t.Fatal(err) }
	if policy.scriptJSONBytes() != 20<<20 || policy.JSONBytes != old.JSONBytes || policy.scriptLimit(scriptResultSeconds, 0) != 19 || policy.scriptLimit(scriptMemoryMiB, 0) != 96 { t.Fatalf("effective policy lost a saved value or altered the HTTP JSON limit: %+v", policy) }
}

func TestSiteClosureExpiresOnlyRegularSessionsAndPreservesSubmittedWork(t *testing.T) {
	a := siteTestApp(t)
	for _, value := range []any{&Session{Hash: "owner-session", UserID: "owner"}, &Session{Hash: "admin-session", UserID: "admin"}, &GenerationTask{ID: "submitted", UserID: "owner", Status: "running"}} {
		if err := a.db.Create(value).Error; err != nil { t.Fatal(err) }
	}
	updates, stop := a.subscribe("owner"); defer stop()
	open := false
	input := siteSettingsInput{Open: &open, AssistantSlots: 1, GenerationSlots: 4, UserSlots: 2}
	_, err := a.SaveSiteSettings("owner", input); requireSiteError(t, err, "forbidden")
	_, err = a.SaveSiteSettings("admin", input); requireSiteError(t, err, "confirmation_required")
	input.Confirmed = true
	saved, err := a.SaveSiteSettings("admin", input); if err != nil { t.Fatal(err) }
	select { case <-updates: default: t.Fatal("connected users were not notified") }
	if err := a.siteAccess(User{Role: "admin"}); err != nil { t.Fatal("administrator cannot reopen site") }
	requireSiteError(t, a.siteAccess(User{Role: "user"}), "site_closed")
	var sessions []Session
	if err := a.db.Find(&sessions).Error; err != nil { t.Fatal(err) }
	if len(sessions) != 1 || sessions[0].UserID != "admin" { t.Fatal("closure kept ordinary sessions or removed administrator sessions") }
	var task GenerationTask
	if err := a.db.First(&task, "id = ?", "submitted").Error; err != nil || task.Status != "running" { t.Fatal("closure changed a submitted task") }
	open = true; input.Open, input.Version = &open, saved.Version-1
	_, err = a.SaveSiteSettings("admin", input); requireSiteError(t, err, "version_conflict")
	input.Version = saved.Version
	if _, err := a.SaveSiteSettings("admin", input); err != nil { t.Fatal(err) }
	if err := a.siteAccess(User{Role: "user"}); err != nil { t.Fatal("reopened site remains inaccessible") }
}

func TestClosedSiteRejectsLoginSessionAndBusinessTokens(t *testing.T) {
	a := siteTestApp(t)
	if err := a.db.Create(&AccessToken{ID: "access", UserID: "owner", Hash: digest("access"), Scopes: JSON(`["read"]`), Projects: JSON(`[]`)}).Error; err != nil { t.Fatal(err) }
	open := false
	if _, err := a.SaveSiteSettings("admin", siteSettingsInput{Open: &open, AssistantSlots: 1, GenerationSlots: 4, UserSlots: 2, Confirmed: true}); err != nil { t.Fatal(err) }
	if _, err := a.tokenPrincipal("access"); err == nil { t.Fatal("ordinary MCP token bypassed closure") } else { requireSiteError(t, err, "site_closed") }
	if _, err := a.CallBusiness(context.Background(), Principal{User: User{ID: "owner"}, Scopes: []string{"read"}}, "projects_list", map[string]any{}); err == nil { t.Fatal("business dispatcher bypassed closure") } else { requireSiteError(t, err, "site_closed") }
	if _, err := a.CallBusiness(context.Background(), Principal{User: User{ID: "admin"}, Scopes: []string{"admin"}}, "admin_site_get", map[string]any{}); err != nil { t.Fatalf("administrator tools blocked while closed: %v", err) }
	router := gin.New()
	router.POST("/api/auth/login", a.login)
	router.GET("/api/auth/me", a.authenticate, func(c *gin.Context) { c.JSON(200, gin.H{"user": currentUser(c)}) })
	router.GET("/events-test", func(c *gin.Context) { c.Set("user", User{ID: "owner", Role: "user"}); a.userEvents(c) })
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest("GET", "/events-test", nil))
	if !strings.Contains(response.Body.String(), "event: site_closed") { t.Fatal("online users did not receive the closure reason") }
	response = httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest("GET", "/api/auth/me", nil))
	if response.Code != 503 || !strings.Contains(response.Body.String(), `"code":"site_closed"`) { t.Fatalf("expired session lost closure reason: %s", response.Body.String()) }
	for _, name := range []string{"owner", "admin"} {
		response = httptest.NewRecorder()
		request := httptest.NewRequest("POST", "/api/auth/login", strings.NewReader(`{"username":"`+name+`","password":"site-test-password"}`))
		request.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(response, request)
		if name == "owner" { if response.Code != 503 { t.Fatalf("ordinary login returned %d", response.Code) }; continue }
		if response.Code != 200 { t.Fatalf("administrator login failed: %s", response.Body.String()) }
		var result map[string]any
		if json.Unmarshal(response.Body.Bytes(), &result) != nil || result["csrf"] == nil { t.Fatal("administrator session missing") }
		request = httptest.NewRequest("GET", "/api/auth/me", nil)
		for _, cookie := range response.Result().Cookies() { request.AddCookie(cookie) }
		response = httptest.NewRecorder(); router.ServeHTTP(response, request)
		if response.Code != http.StatusOK { t.Fatal("administrator session blocked while closed") }
	}
}
