package app

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestImportantLogsSkipRoutineRequestsEvenWithDiagnostics(t *testing.T) {
	var output bytes.Buffer
	a := &App{logs: &appLogger{logger: slog.New(slog.NewJSONHandler(&output, &slog.HandlerOptions{Level: slog.LevelDebug}))}}
	a.logs.settings.Store(&LogSettings{Enabled: true, Development: true})
	router := gin.New(); router.Use(a.requestLogger())
	for _, route := range []string{"/api/health", "/api/tasks", "/api/admin/logging/entries"} { router.GET(route, func(c *gin.Context) { c.Status(200) }) }
	for _, route := range []string{"/api/health", "/api/tasks", "/api/admin/logging/entries"} { router.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", route, nil)) }
	a.logEvent(context.Background(), slog.LevelDebug, "provider.completed")
	if output.Len() != 0 { t.Fatal("routine requests or diagnostics were written") }
	a.logEvent(context.Background(), slog.LevelInfo, "service.ready")
	if !strings.Contains(output.String(), "service.ready") { t.Fatal("important service event was omitted") }
	router.PUT("/api/admin/site", func(c *gin.Context) { c.Status(200) })
	router.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("PUT", "/api/admin/site", nil))
	if !strings.Contains(output.String(), "admin.configuration_changed") { t.Fatal("administrator configuration changes were omitted") }
	router.POST("/api/failure", func(c *gin.Context) { respondError(c, problem(503, "unavailable", "private path and credentials")) })
	router.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("POST", "/api/failure?credential=private-query", nil))
	for _, value := range []string{"http.request", "ERROR", "unavailable"} { if !strings.Contains(output.String(), value) { t.Fatal("request failure details were omitted") } }
	for _, secret := range []string{"private path", "private-query"} { if strings.Contains(output.String(), secret) { t.Fatal("request failure exposed sensitive data") } }
	output.Reset(); a.logs.settings.Store(&LogSettings{})
	a.logFailure(context.Background(), "disabled.failure", errors.New("error"))
	if output.Len() != 0 { t.Fatal("disabled logging wrote an error") }
}

func TestErrorDiagnosticsOnlyAddSafeErrorDetails(t *testing.T) {
	var output bytes.Buffer
	a := &App{logs: &appLogger{logger: slog.New(slog.NewJSONHandler(&output, nil))}}
	failure := errors.New("TypeError at script.js:42 secret-token https://private.example /server/private/path")
	for _, development := range []bool{false, true} {
		output.Reset(); a.logs.settings.Store(&LogSettings{Enabled: true, Development: development})
		a.logFailure(context.Background(), "script.failed", failure)
		if !strings.Contains(output.String(), "script_exception") || strings.Contains(output.String(), "script.js:42") != development { t.Fatal("diagnostics did not control safe script details") }
		for _, secret := range []string{"secret-token", "private.example", "/server/private/path"} { if strings.Contains(output.String(), secret) { t.Fatal("diagnostics exposed the raw error") } }
	}
}
