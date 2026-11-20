package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func logTestLine(index int) string { return fmt.Sprintf("{\"time\":\"2026-11-21T00:00:00Z\",\"level\":\"INFO\",\"msg\":\"event.%d\"}\n", index) }

func logTestFile(t *testing.T, store *logStore, name string, start, end int) {
	t.Helper()
	if err := os.MkdirAll(store.directory, 0700); err != nil { t.Fatal(err) }
	var data strings.Builder
	for index := start; index < end; index++ { data.WriteString(logTestLine(index)) }
	if err := os.WriteFile(filepath.Join(store.directory, name), []byte(data.String()), 0600); err != nil { t.Fatal(err) }
}

func logTestMessages(t *testing.T, page logPage, first, count int) {
	t.Helper()
	if len(page.Entries) != count { t.Fatalf("got %d entries, want %d", len(page.Entries), count) }
	for index, raw := range page.Entries {
		var entry struct { Message string `json:"msg"` }
		if err := json.Unmarshal(raw, &entry); err != nil { t.Fatal(err) }
		if entry.Message != fmt.Sprintf("event.%d", first-index) { t.Fatalf("unexpected event %q at %d", entry.Message, index) }
	}
}

func TestLogPaginationSurvivesAppendAndRotation(t *testing.T) {
	store := newLogStore(t.TempDir()); t.Cleanup(func() { store.Close() })
	logTestFile(t, store, "application-2026-11-21T00-00-00.000.log", 0, 120)
	logTestFile(t, store, "application.log", 120, 250)
	latest, err := store.page(""); if err != nil { t.Fatal(err) }
	logTestMessages(t, latest, 249, 100)
	if latest.NextCursor == "" || latest.Files != 2 || latest.Bytes == 0 { t.Fatal("missing pagination or storage usage") }
	if err := os.Rename(store.writer.Filename, filepath.Join(store.directory, "application-2026-11-21T00-01-00.000.log")); err != nil { t.Fatal(err) }
	logTestFile(t, store, "application.log", 250, 255)
	older, err := store.page(latest.NextCursor); if err != nil { t.Fatal(err) }
	logTestMessages(t, older, 149, 100)
	oldest, err := store.page(older.NextCursor); if err != nil { t.Fatal(err) }
	logTestMessages(t, oldest, 49, 50)
	if oldest.NextCursor != "" { t.Fatal("oldest batch has another cursor") }
	if err := os.Remove(filepath.Join(store.directory, "application-2026-11-21T00-01-00.000.log")); err != nil { t.Fatal(err) }
	_, err = store.page(latest.NextCursor)
	var failure *Problem
	if !errors.As(err, &failure) || failure.Code != "log_cursor_expired" { t.Fatalf("removed batch returned %v", err) }
}

func TestLogNumberedPagesCountAndClampToExistingRecords(t *testing.T) {
	for _, total := range []int{0, 20, 21, 40, 41} {
		t.Run(fmt.Sprint(total), func(t *testing.T) {
			store := newLogStore(t.TempDir()); t.Cleanup(func() { store.Close() })
			logTestFile(t, store, "application-2026-11-21T00-00-00.000.log", 0, total/2)
			logTestFile(t, store, "application.log", total/2, total)
			a := &App{logs: &appLogger{store: store}}
			for _, size := range []int{20, 50, 100} {
				pages := max(1, (total+size-1)/size)
				for _, requested := range []int{1, 2, 999} {
					page, err := a.ReadLogPage(requested, size); if err != nil { t.Fatal(err) }
					number := min(requested, pages)
					if page.Total != total || page.Page != number || page.PageSize != size { t.Fatalf("incorrect page metadata: %+v", page) }
					first := total-1-(number-1)*size
					logTestMessages(t, page, first, min(size, first+1))
				}
			}
			for _, invalid := range [][2]int{{0, 20}, {1, 0}, {1, 21}} {
				if _, err := a.ReadLogPage(invalid[0], invalid[1]); err == nil { t.Fatal("invalid page request was accepted") }
			}
			if err := store.clear(); err != nil { t.Fatal(err) }
			page, err := a.ReadLogPage(999, 20); if err != nil { t.Fatal(err) }
			if page.Total != 0 || page.Page != 1 || len(page.Entries) != 0 { t.Fatal("cleared logs retained empty pages") }
		})
	}
}

func TestLogRotationRetainsThreeBackupsAndClearPreservesOtherFiles(t *testing.T) {
	root := t.TempDir(); store := newLogStore(root); t.Cleanup(func() { store.Close() })
	oldest := ""
	for index := 0; index < logBackupCount; index++ {
		name := "application-"+time.Now().Add(-24*time.Hour+time.Duration(index)*time.Second).UTC().Format(logBackupTime)+".log"
		if index == 0 { oldest = name }; logTestFile(t, store, name, index, index+1)
	}
	data := strings.TrimSuffix(logTestLine(3), "}\n")+`,"padding":"`
	data += strings.Repeat("x", int(logFileBytes)-len(data)-3)+"\"}\n"
	if err := os.WriteFile(store.writer.Filename, []byte(data), 0600); err != nil { t.Fatal(err) }
	untouched := []string{filepath.Join(root, "asset.bin"), filepath.Join(store.directory, "other.log"), filepath.Join(store.directory, "application-not-a-date.log")}
	for _, path := range untouched { if err := os.WriteFile(path, []byte("keep"), 0600); err != nil { t.Fatal(err) } }
	if _, err := store.Write([]byte(logTestLine(4))); err != nil { t.Fatal(err) }
	page, err := store.page(""); if err != nil { t.Fatal(err) }
	logTestMessages(t, page, 4, 4)
	if page.Files != 4 || page.Bytes > 4*logFileBytes { t.Fatal("log retention boundary was exceeded") }
	if _, err := os.Stat(filepath.Join(store.directory, oldest)); !errors.Is(err, os.ErrNotExist) { t.Fatal("oldest backup was retained") }
	if err := store.clear(); err != nil { t.Fatal(err) }
	page, err = store.page(""); if err != nil { t.Fatal(err) }
	if page.Bytes != 0 || page.Files != 0 || len(page.Entries) != 0 { t.Fatal("clear retained application logs") }
	for _, path := range untouched { data, err := os.ReadFile(path); if err != nil || string(data) != "keep" { t.Fatal("clear changed an unrelated file") } }
	if _, err := store.Write([]byte(logTestLine(5))); err != nil { t.Fatal(err) }
	page, err = store.page(""); if err != nil { t.Fatal(err) }; logTestMessages(t, page, 5, 1)
}

func TestLogWriteRecoversIncompleteTail(t *testing.T) {
	store := newLogStore(t.TempDir()); t.Cleanup(func() { store.Close() })
	logTestFile(t, store, "application.log", 0, 1)
	file, err := os.OpenFile(store.writer.Filename, os.O_APPEND|os.O_WRONLY, 0600); if err != nil { t.Fatal(err) }
	if _, err := file.WriteString(strings.Repeat("x", 5000)); err != nil { file.Close(); t.Fatal(err) }; file.Close()
	page, err := store.page(""); if err != nil { t.Fatal(err) }; logTestMessages(t, page, 0, 1)
	if _, err := store.Write([]byte(logTestLine(1))); err != nil { t.Fatal(err) }
	page, err = store.page(""); if err != nil { t.Fatal(err) }; logTestMessages(t, page, 1, 2)
}

func TestLogWriteFailurePreservesTerminalOutputAndRecovers(t *testing.T) {
	store := newLogStore(t.TempDir()); t.Cleanup(func() { store.Close() })
	if err := os.WriteFile(store.directory, []byte("blocked"), 0600); err != nil { t.Fatal(err) }
	terminal, err := os.CreateTemp(t.TempDir(), "terminal"); if err != nil { t.Fatal(err) }
	previous := os.Stdout; os.Stdout = terminal; defer func() { os.Stdout = previous; terminal.Close() }()
	line := logTestLine(0)
	if n, err := store.Write([]byte(line)); err != nil || n != len(line) || store.failure != "write" { t.Fatal("disk failure escaped into business execution") }
	output, err := os.ReadFile(terminal.Name()); if err != nil || string(output) != line { t.Fatal("disk failure suppressed terminal output") }
	_, err = store.page(""); if err == nil || strings.Contains(err.Error(), store.directory) { t.Fatal("storage failure leaked a path or was hidden") }
	if err := os.Remove(store.directory); err != nil { t.Fatal(err) }
	if _, err := store.Write([]byte(logTestLine(1))); err != nil { t.Fatal(err) }
	page, err := store.page(""); if err != nil { t.Fatal(err) }; logTestMessages(t, page, 1, 1)
	if page.StorageError != "" { t.Fatal("storage did not recover") }
}

func TestLogToolsRequireGlobalAdminPermissionAndClearConfirmation(t *testing.T) {
	a := assetFileTestApp(t)
	a.logs = &appLogger{store: newLogStore(a.root)}; t.Cleanup(func() { a.logs.store.Close() })
	logTestFile(t, a.logs.store, "application.log", 0, 1)
	principal := Principal{User: User{ID: "owner"}, Scopes: []string{"admin"}}
	if _, err := a.CallBusiness(context.Background(), principal, "admin_logs_read", nil); err == nil { t.Fatal("non-admin read server logs") }
	if err := a.db.Model(&User{}).Where("id = ?", "owner").Update("role", "admin").Error; err != nil { t.Fatal(err) }
	for _, denied := range []Principal{{User: User{ID: "owner"}, Scopes: []string{"read"}}, {User: User{ID: "owner"}, Scopes: []string{"admin"}, Projects: []string{"project"}}} {
		for _, name := range []string{"admin_logs_read", "admin_logs_clear"} { if _, err := a.CallBusiness(context.Background(), denied, name, map[string]any{"confirmed": true}); err == nil { t.Fatal("logs escaped admin authorization") } }
	}
	if _, err := a.CallBusiness(context.Background(), principal, "admin_logs_clear", map[string]any{}); err == nil { t.Fatal("logs cleared without confirmation") }
	value, err := a.CallBusiness(context.Background(), principal, "admin_logs_read", nil); if err != nil { t.Fatal(err) }; logTestMessages(t, value.(logPage), 0, 1)
	value, err = a.CallBusiness(context.Background(), principal, "admin_logs_clear", map[string]any{"confirmed": true}); if err != nil { t.Fatal(err) }
	if value.(logPage).Bytes != 0 { t.Fatal("confirmed clear retained logs") }
}
