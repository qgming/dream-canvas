package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"os"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gin-gonic/gin"
	openai "github.com/openai/openai-go/v3"
	"gorm.io/gorm"
)

type LogSettings struct {
	ID uint `json:"-" gorm:"primaryKey"`
	Version uint64 `json:"version"`
	Enabled bool `json:"enabled"`
	Development bool `json:"development"`
	UpdatedBy string `json:"updatedBy,omitempty"`
	UpdatedAt time.Time `json:"updatedAt,omitempty"`
}

type logSettingsInput struct {
	Version uint64 `json:"version"`
	Enabled *bool `json:"enabled"`
	Development *bool `json:"development"`
}

type appLogger struct {
	logger *slog.Logger
	settings atomic.Pointer[LogSettings]
	store *logStore
	mu sync.Mutex
}

type logContextKey struct{}

func withLogContext(ctx context.Context, fields ...slog.Attr) context.Context {
	previous, _ := ctx.Value(logContextKey{}).([]slog.Attr)
	return context.WithValue(ctx, logContextKey{}, append(append([]slog.Attr{}, previous...), fields...))
}

func (a *App) openLogger() error {
	settings, err := a.GetLogSettings(); if err != nil { return err }
	store := newLogStore(a.root)
	a.logs = &appLogger{store: store, logger: slog.New(slog.NewJSONHandler(store, &slog.HandlerOptions{Level: slog.LevelDebug}))}
	a.logs.settings.Store(&settings)
	return nil
}

func (a *App) logEnabled(level slog.Level) bool {
	if a.logs == nil { return false }
	settings := a.logs.settings.Load()
	return settings != nil && settings.Enabled && (level >= slog.LevelInfo || settings.Development)
}

func (a *App) logEvent(ctx context.Context, level slog.Level, event string, fields ...slog.Attr) {
	if !a.logEnabled(level) { return }
	shared, _ := ctx.Value(logContextKey{}).([]slog.Attr)
	attributes := make([]slog.Attr, 0, len(shared)+len(fields))
	positions := map[string]int{}
	for _, field := range append(append([]slog.Attr{}, shared...), fields...) {
		if index, exists := positions[field.Key]; exists { attributes[index] = field } else { positions[field.Key] = len(attributes); attributes = append(attributes, field) }
	}
	a.logs.logger.LogAttrs(ctx, level, event, attributes...)
}

var scriptExceptionPattern = regexp.MustCompile(`\b(?:SyntaxError|TypeError|ReferenceError|RangeError|InternalError|EvalError)\b`)
var scriptLocationPattern = regexp.MustCompile(`\bscript\.js:\d+(?::\d+)?\b`)
var wasmFunctionPattern = regexp.MustCompile(`failed to call ([A-Za-z_][A-Za-z_0-9]*)`)

// Errors may contain prompts, response bodies, secrets or filesystem paths. Emit
// technical classifications and script locations only, never the raw message.
func diagnosticError(err error) slog.Attr {
	fields := []slog.Attr{slog.String("type", fmt.Sprintf("%T", err))}
	kind := "execution_error"
	message := ""
	for cause := err; cause != nil; cause = errors.Unwrap(cause) { message += "\n"+cause.Error() }
	details := message
	message = strings.ToLower(message)
	switch {
	case errors.Is(err, context.DeadlineExceeded), strings.Contains(message, "context deadline exceeded"): kind = "timeout"
	case errors.Is(err, context.Canceled), strings.Contains(message, "context canceled"): kind = "cancelled"
	case errors.Is(err, io.ErrUnexpectedEOF): kind = "incomplete_response"
	case errors.Is(err, os.ErrNotExist): kind = "file_missing"
	case errors.Is(err, os.ErrPermission): kind = "file_permission"
	case strings.Contains(message, "out of memory"), strings.Contains(message, "memory limit"), strings.Contains(message, "allocation failed"), strings.Contains(message, "failed to allocate"), strings.Contains(message, "out of bounds memory"): kind = "memory_boundary"
	case strings.Contains(message, "wasm error"), strings.Contains(message, "unreachable"), strings.Contains(message, "module closed"): kind = "wasm_trap"
	case strings.Contains(message, "json boundary"), strings.Contains(message, "json 边界"), strings.Contains(message, "configured boundary"): kind = "json_boundary"
	case strings.Contains(message, "invalid stream json"), strings.Contains(message, "valid json"), strings.Contains(message, "需要 json 对象"): kind = "invalid_json"
	}
	var request *openai.Error; if errors.As(err, &request) { kind = "provider_http"; fields = append(fields, slog.Int("http_status", request.StatusCode)) }
	var dns *net.DNSError; if errors.As(err, &dns) { kind = "dns_error" }
	var network *net.OpError; if errors.As(err, &network) && kind == "execution_error" { kind = "network_error" }
	var timeout net.Error; if errors.As(err, &timeout) && timeout.Timeout() { kind = "timeout" }
	var syntax *json.SyntaxError; if errors.As(err, &syntax) { kind = "invalid_json"; fields = append(fields, slog.Int64("offset", syntax.Offset)) }
	var parse *scriptParseError; if errors.As(err, &parse) { if kind == "execution_error" { kind = "script_result_contract" }; fields = append(fields, slog.String("parse_phase", parse.phase)) }
	var problem *Problem; if errors.As(err, &problem) { fields = append(fields, slog.String("code", problem.Code), slog.Int("status", problem.Status)) }
	if name := scriptExceptionPattern.FindString(details); name != "" { fields = append(fields, slog.String("exception", name)); if kind == "execution_error" { kind = "script_exception" } }
	if location := scriptLocationPattern.FindString(details); location != "" { fields = append(fields, slog.String("location", location)) }
	if function := wasmFunctionPattern.FindStringSubmatch(details); len(function) == 2 && includes([]string{"QJS_Eval", "QJS_Free", "QJS_FreeValue", "QJS_CreateEvalOption", "QJS_ToCString", "JS_FreeCString", "malloc", "free"}, function[1]) { fields = append(fields, slog.String("wasm_function", function[1])) }
	return slog.Attr{Key: "failure", Value: slog.GroupValue(append(fields, slog.String("kind", kind))...)}
}

func (a *App) logFailure(ctx context.Context, event string, err error, fields ...slog.Attr) {
	if err == nil || !a.logEnabled(slog.LevelError) { return }
	a.logEvent(ctx, slog.LevelError, event, append(fields, diagnosticError(err))...)
}

func (a *App) requestLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		started := time.Now()
		requestID := identifier()
		c.Header("X-Request-ID", requestID)
		c.Request = c.Request.WithContext(withLogContext(c.Request.Context(), slog.String("request_id", requestID)))
		c.Next()
		if c.FullPath() == "/api/admin/logging/entries" { return }
		if !strings.HasPrefix(c.Request.URL.Path, "/api/") && c.Request.URL.Path != "/mcp" { return }
		if !a.logEnabled(slog.LevelInfo) { return }
		route := c.FullPath(); if route == "" { route = "unmatched" }
		fields := []slog.Attr{slog.String("method", c.Request.Method), slog.String("route", route), slog.Int("status", c.Writer.Status()), slog.Int64("duration_ms", time.Since(started).Milliseconds()), slog.Int("response_bytes", c.Writer.Size())}
		if user, ok := c.Get("user"); ok { fields = append(fields, slog.String("user_id", user.(User).ID)) }
		if err, exists := c.Get("request_error"); exists { if failure, ok := err.(error); ok { fields = append(fields, diagnosticError(failure)) } }
		level := slog.LevelInfo; if c.Writer.Status() >= 500 { level = slog.LevelError } else if c.Writer.Status() >= 400 { level = slog.LevelWarn }
		a.logEvent(c.Request.Context(), level, "http.request", fields...)
	}
}

func (a *App) recoverRequest(c *gin.Context, recovered any) {
	a.logFailure(c.Request.Context(), "http.panic", fmt.Errorf("%v", recovered))
	respondError(c, problem(500, "internal_error", "操作失败，请重试"))
}

func (a *App) getLogSettings(c *gin.Context) {
	settings, err := a.GetLogSettings(); if err != nil { respondError(c, err); return }; c.JSON(200, settings)
}

func (a *App) saveLogSettings(c *gin.Context) {
	var input logSettingsInput; if !bind(c, &input) { return }
	if input.Enabled == nil || input.Development == nil { respondError(c, problem(400, "invalid_logging", "请明确日志和开发诊断开关")); return }
	settings, err := a.SaveLogSettings(currentUser(c).ID, input.Version, *input.Enabled, *input.Development)
	if err != nil { respondError(c, err); return }; c.JSON(200, settings)
}

func (a *App) GetLogSettings() (LogSettings, error) {
	var settings LogSettings
	err := a.db.First(&settings, 1).Error
	if errors.Is(err, gorm.ErrRecordNotFound) { return LogSettings{}, nil }
	return settings, err
}

func (a *App) SaveLogSettings(userID string, version uint64, enabled, development bool) (LogSettings, error) {
	if development && !enabled { return LogSettings{}, problem(400, "logging_disabled", "请先启用后台运行日志，再开启开发诊断日志") }
	a.logs.mu.Lock(); defer a.logs.mu.Unlock()
	settings := LogSettings{ID: 1, Version: version+1, Enabled: enabled, Development: development, UpdatedBy: userID, UpdatedAt: time.Now()}
	err := a.db.Transaction(func(tx *gorm.DB) error {
		var previous LogSettings
		err := tx.First(&previous, 1).Error
		if errors.Is(err, gorm.ErrRecordNotFound) { if version != 0 { return problem(409, "version_conflict", "日志设置已更新，请重新读取；当前修改未覆盖") }; return tx.Create(&settings).Error }
		if err != nil { return err }
		if previous.Version != version { return problem(409, "version_conflict", "日志设置已更新，请重新读取；当前修改未覆盖") }
		return tx.Model(&previous).Updates(map[string]any{"version": settings.Version, "enabled": settings.Enabled, "development": settings.Development, "updated_by": userID, "updated_at": settings.UpdatedAt}).Error
	})
	if err != nil { return LogSettings{}, err }
	// The disabling event uses the previous configuration; enabled events use the new one.
	if !enabled { a.logEvent(a.ctx, slog.LevelInfo, "logging.settings_changed", slog.String("user_id", userID), slog.Bool("enabled", enabled), slog.Bool("development", development)) }
	a.logs.settings.Store(&settings)
	if enabled { a.logEvent(a.ctx, slog.LevelInfo, "logging.settings_changed", slog.String("user_id", userID), slog.Bool("enabled", enabled), slog.Bool("development", development)) }
	return settings, nil
}
