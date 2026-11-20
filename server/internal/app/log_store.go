package app

import (
	"bufio"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"gopkg.in/natefinch/lumberjack.v2"
)

const logFileBytes int64 = 5 * 1024 * 1024
const logBackupCount = 3
const logReadCount = 100
const logBackupTime = "2006-01-02T15-04-05.000"

// lumberjack handles file rotation; retention runs synchronously so failures
// are visible to administrators and cannot race a read or manual clear.
type logStore struct {
	mu sync.Mutex
	directory string
	writer *lumberjack.Logger
	size int64
	opened bool
	failure string
}

type logFile struct { name string; size int64 }
type logCursor struct { File string `json:"file"`; Offset int64 `json:"offset"` }
type logPage struct {
	Entries []json.RawMessage `json:"entries"`
	Bytes int64 `json:"bytes"`
	Files int `json:"files"`
	FileBytes int64 `json:"fileBytes"`
	MaxFiles int `json:"maxFiles"`
	PageSize int `json:"pageSize"`
	Page int `json:"page"`
	Total int `json:"total"`
	NextCursor string `json:"nextCursor"`
	StorageError string `json:"storageError"`
}

func newLogStore(root string) *logStore {
	directory := filepath.Join(root, "logs")
	return &logStore{directory: directory, writer: &lumberjack.Logger{Filename: filepath.Join(directory, "application.log"), MaxSize: int(logFileBytes / (1024 * 1024))}}
}

func (s *logStore) files() ([]logFile, error) {
	info, err := os.Lstat(s.directory)
	if errors.Is(err, os.ErrNotExist) { return []logFile{}, nil }
	if err != nil { return nil, err }
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 { return nil, os.ErrPermission }
	entries, err := os.ReadDir(s.directory); if err != nil { return nil, err }
	files := []logFile{}
	for _, entry := range entries {
		name := entry.Name()
		if name != "application.log" {
			if !strings.HasPrefix(name, "application-") || !strings.HasSuffix(name, ".log") { continue }
			if _, err := time.Parse(logBackupTime, strings.TrimSuffix(strings.TrimPrefix(name, "application-"), ".log")); err != nil { continue }
		}
		info, err := entry.Info(); if err != nil { return nil, err }
		if !info.Mode().IsRegular() { return nil, os.ErrPermission }
		files = append(files, logFile{name, info.Size()})
	}
	sort.Slice(files, func(i, j int) bool { if files[i].name == "application.log" { return false }; if files[j].name == "application.log" { return true }; return files[i].name < files[j].name })
	return files, nil
}

func (s *logStore) retain() error {
	files, err := s.files(); if err != nil { return err }
	backups := []logFile{}
	for _, file := range files { if file.name != "application.log" { backups = append(backups, file) } }
	for len(backups) > logBackupCount {
		if err := os.Remove(filepath.Join(s.directory, backups[0].name)); err != nil && !errors.Is(err, os.ErrNotExist) { return err }
		backups = backups[1:]
	}
	return nil
}

// A failed write or process exit can leave an incomplete final JSON line.
// Preserve completed events before appending another event to the current file.
func (s *logStore) trimTail() error {
	if s.size == 0 { return nil }
	file, err := os.OpenFile(s.writer.Filename, os.O_RDWR, 0600); if err != nil { return err }; defer file.Close()
	var buffer [4096]byte
	for end := s.size; end > 0; {
		start := max(int64(0), end-int64(len(buffer)))
		n, err := file.ReadAt(buffer[:int(end-start)], start); if err != nil { return err }
		if index := bytes.LastIndexByte(buffer[:n], '\n'); index >= 0 {
			size := start+int64(index)+1
			if size == s.size { return nil }
			if err := file.Truncate(size); err != nil { return err }; s.size = size; return nil
		}
		end = start
	}
	if err := file.Truncate(0); err != nil { return err }; s.size = 0; return nil
}

func (s *logStore) Write(data []byte) (int, error) {
	// A file failure must never suppress the existing terminal output.
	_, _ = os.Stdout.Write(data)
	s.mu.Lock(); defer s.mu.Unlock()
	first := !s.opened
	if s.failure == "cleanup" { if err := s.retain(); err != nil { return len(data), nil } }
	if first {
		if err := os.MkdirAll(s.directory, 0700); err != nil { s.failure = "write"; return len(data), nil }
		files, err := s.files(); if err != nil { s.failure = "write"; return len(data), nil }
		s.size = 0
		for _, file := range files { if file.name == "application.log" { s.size = file.size } }
		if err := s.trimTail(); err != nil { s.failure = "write"; return len(data), nil }
	}
	rotating := s.size+int64(len(data)) >= logFileBytes
	n, err := s.writer.Write(data)
	if err != nil { s.failure = "write"; _ = s.writer.Close(); s.opened = false; return len(data), nil }
	s.opened = true; s.size += int64(n)
	if first || rotating || s.failure != "" {
		if err := s.retain(); err != nil { s.failure = "cleanup"; return len(data), nil }
		info, err := os.Stat(s.writer.Filename); if err != nil { s.failure = "write"; return len(data), nil }; s.size = info.Size()
	}
	s.failure = ""
	return len(data), nil
}

func (s *logStore) Close() error { s.mu.Lock(); defer s.mu.Unlock(); s.opened = false; return s.writer.Close() }

func (s *logStore) page(cursor string) (logPage, error) { return s.readPage(cursor, 1, logReadCount) }

func (s *logStore) readPage(cursor string, number, size int) (logPage, error) {
	s.mu.Lock(); defer s.mu.Unlock()
	page := logPage{Entries: []json.RawMessage{}, FileBytes: logFileBytes, MaxFiles: logBackupCount+1, PageSize: size, Page: number, StorageError: s.failure}
	files, err := s.files(); if err != nil { return page, problem(500, "log_read_failed", "日志文件无法读取，请检查日志目录权限后重试") }
	for _, file := range files { page.Bytes += file.size }; page.Files = len(files)
	var before logCursor
	if cursor != "" {
		decoded, err := base64.RawURLEncoding.DecodeString(cursor)
		if err != nil || json.Unmarshal(decoded, &before) != nil || before.File == "" || before.Offset < 0 || before.Offset > logFileBytes { return page, problem(400, "invalid_log_cursor", "日志分页位置不正确，请刷新日志") }
	}
	type indexedFile struct { file logFile; id string; offsets []int64 }
	indexed := []indexedFile{}
	found := cursor == ""
	for _, item := range files {
		file, err := os.Open(filepath.Join(s.directory, item.name)); if err != nil { return page, problem(500, "log_read_failed", "日志文件无法读取，请刷新后重试") }
		reader := bufio.NewReader(io.NewSectionReader(file, 0, item.size))
		offset, fileID, matched := int64(0), "", false
		offsets := []int64{0}
		for {
			start := offset
			data, readErr := reader.ReadBytes('\n'); offset += int64(len(data))
			if len(data) > 0 && data[len(data)-1] == '\n' {
				if fileID == "" { fileID = digest(string(data)); matched = cursor != "" && fileID == before.File; if matched { found = true } }
				if matched && start >= before.Offset { break }
				offsets = append(offsets, offset)
			}
			if readErr != nil { if !errors.Is(readErr, io.EOF) { file.Close(); return page, problem(500, "log_read_failed", "日志读取失败，请刷新后重试") }; break }
		}
		file.Close()
		indexed = append(indexed, indexedFile{item, fileID, offsets})
		page.Total += len(offsets)-1
		if matched { break }
	}
	if !found { return page, problem(409, "log_cursor_expired", "这批日志已被轮转或清空，请查看最新日志") }
	page.Page = min(number, max(1, (page.Total+size-1)/size))
	skip := (page.Page-1)*size
	var last logCursor
	for index := len(indexed)-1; index >= 0 && len(page.Entries) < size; index-- {
		item := indexed[index]
		count := len(item.offsets)-1
		if skip >= count { skip -= count; continue }
		file, err := os.Open(filepath.Join(s.directory, item.file.name)); if err != nil { return page, problem(500, "log_read_failed", "日志文件无法读取，请刷新后重试") }
		for line := count-skip-1; line >= 0 && len(page.Entries) < size; line-- {
			entry := make(json.RawMessage, int(item.offsets[line+1]-item.offsets[line]))
			if _, err := file.ReadAt(entry, item.offsets[line]); err != nil { file.Close(); return page, problem(500, "log_read_failed", "日志读取失败，请刷新后重试") }
			var fields map[string]any
			if json.Unmarshal(entry, &fields) != nil { file.Close(); return page, problem(500, "log_read_failed", "日志内容不完整，无法读取；请清空日志后重新记录") }
			if _, ok := fields["time"].(string); !ok { file.Close(); return page, problem(500, "log_read_failed", "日志时间不正确，无法读取；请清空日志后重新记录") }
			if _, ok := fields["level"].(string); !ok { file.Close(); return page, problem(500, "log_read_failed", "日志级别不正确，无法读取；请清空日志后重新记录") }
			if _, ok := fields["msg"].(string); !ok { file.Close(); return page, problem(500, "log_read_failed", "日志事件不正确，无法读取；请清空日志后重新记录") }
			page.Entries = append(page.Entries, entry); last = logCursor{item.id, item.offsets[line]}
		}
		file.Close(); skip = 0
	}
	if page.Total > (page.Page-1)*size+len(page.Entries) { encoded, _ := json.Marshal(last); page.NextCursor = base64.RawURLEncoding.EncodeToString(encoded) }
	return page, nil
}

func (s *logStore) clear() error {
	s.mu.Lock(); defer s.mu.Unlock()
	if err := s.writer.Close(); err != nil { s.failure = "cleanup"; return problem(500, "log_clear_failed", "日志文件无法关闭，尚未清空，请重试") }
	s.opened = false; s.size = 0
	files, err := s.files(); if err != nil { s.failure = "cleanup"; return problem(500, "log_clear_failed", "日志目录无法读取，尚未清空，请检查权限后重试") }
	var failure error
	for _, file := range files { if err := os.Remove(filepath.Join(s.directory, file.name)); err != nil && !errors.Is(err, os.ErrNotExist) { failure = err } }
	if failure != nil { s.failure = "cleanup"; return problem(500, "log_clear_failed", "部分日志未能清空，请检查日志目录权限后重试") }
	s.failure = ""
	return nil
}

func (a *App) ReadLogs(cursor string) (logPage, error) { return a.logs.store.page(cursor) }
func (a *App) ReadLogPage(number, size int) (logPage, error) {
	if number < 1 || (size != 20 && size != 50 && size != 100) { return logPage{}, problem(400, "invalid_log_page", "日志页码或每页数量不正确") }
	return a.logs.store.readPage("", number, size)
}
func (a *App) ClearLogs(confirmed bool) (logPage, error) {
	if !confirmed { return logPage{}, problem(400, "confirmation_required", "请确认清空应用日志") }
	if err := a.logs.store.clear(); err != nil { return logPage{}, err }
	return a.ReadLogs("")
}
func (a *App) readLogs(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if c.Query("page") != "" || c.Query("pageSize") != "" {
		number, pageErr := strconv.Atoi(c.DefaultQuery("page", "1")); size, sizeErr := strconv.Atoi(c.DefaultQuery("pageSize", "100"))
		if pageErr != nil || sizeErr != nil { respondError(c, problem(400, "invalid_log_page", "日志页码或每页数量不正确")); return }
		page, err := a.ReadLogPage(number, size); if err != nil { respondError(c, err); return }; c.JSON(200, page); return
	}
	page, err := a.ReadLogs(c.Query("cursor")); if err != nil { respondError(c, err); return }; c.JSON(200, page)
}
func (a *App) clearLogs(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	var input struct { Confirmed bool `json:"confirmed"` }; if !bind(c, &input) { return }
	page, err := a.ClearLogs(input.Confirmed); if err != nil { respondError(c, err); return }; c.JSON(200, page)
}
