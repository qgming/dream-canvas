package app

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/gin-gonic/gin"
)

const maxUserSSEStreams = 8
const sseHeartbeatInterval = 25 * time.Second

// Notifications only wake a reader; authoritative snapshots always come from SQLite.
func (a *App) subscribe(userID string) (<-chan string, func(), error) {
	ch := make(chan string, 1)
	a.eventsMu.Lock()
	if len(a.events[userID]) >= maxUserSSEStreams {
		a.eventsMu.Unlock()
		return nil, nil, problem(429, "too_many_streams", "当前账号同时打开的实时连接过多，请关闭多余标签页后重试")
	}
	if a.events[userID] == nil { a.events[userID] = map[chan string]bool{} }
	a.events[userID][ch] = true
	a.eventsMu.Unlock()
	return ch, func() {
		a.eventsMu.Lock()
		delete(a.events[userID], ch)
		if len(a.events[userID]) == 0 { delete(a.events, userID) }
		a.eventsMu.Unlock()
	}, nil
}

func (a *App) notify(userID string) {
	a.notifyTopic(userID, "all")
}

func (a *App) notifyTopic(userID, topic string) {
	a.eventsMu.Lock()
	defer a.eventsMu.Unlock()
	for ch := range a.events[userID] {
		select { case ch <- topic: default: select { case previous := <-ch: if previous != topic { topic = "all" }; default: }; select { case ch <- topic: default: } }
	}
}

func (a *App) notifyCatalog() {
	a.eventsMu.Lock()
	defer a.eventsMu.Unlock()
	for _, subscribers := range a.events { for ch := range subscribers { select { case <-ch: default: }; select { case ch <- "all": default: } } }
}

func writeEvent(c *gin.Context, name string, value any) error {
	data, err := json.Marshal(value)
	if err != nil { return err }
	_, err = fmt.Fprintf(c.Writer, "event: %s\ndata: %s\n\n", name, data)
	if err == nil { c.Writer.Flush() }
	return err
}

func writeHeartbeat(c *gin.Context) error {
	_, err := fmt.Fprint(c.Writer, ": ping\n\n")
	if err == nil { c.Writer.Flush() }
	return err
}

func (a *App) sessionValid(c *gin.Context) bool {
	if a.siteAccess(currentUser(c)) != nil { return false }
	var count int64
	return a.db.Model(&Session{}).Where("hash = ? AND expires_at > ? AND user_id IN (?)", c.GetString("session"), time.Now(), a.db.Model(&User{}).Select("id").Where("id = ? AND disabled = ?", currentUser(c).ID, false)).Count(&count).Error == nil && count == 1
}

func (a *App) userEvents(c *gin.Context) {
	updates, stop, err := a.subscribe(currentUser(c).ID)
	if err != nil { respondError(c, err); return }
	defer stop()
	c.Header("Content-Type", "text/event-stream")
	c.Header("X-Accel-Buffering", "no")
	closed := func() bool {
		if currentUser(c).Role == "admin" { return false }
		open, err := a.siteOpen()
		if err != nil || open { return false }
		_ = writeEvent(c, "site_closed", map[string]string{"message": "梦想画布已关闭"})
		return true
	}
	if closed() { return }
	if writeEvent(c, "changed", map[string]bool{"refresh": true}) != nil { return }
	heartbeat := time.NewTicker(sseHeartbeatInterval)
	defer heartbeat.Stop()
	for {
		select {
		case <-c.Request.Context().Done(): return
		case <-heartbeat.C:
			if closed() || !a.sessionValid(c) || writeHeartbeat(c) != nil { return }
		case topic := <-updates:
			if closed() { return }
			if !a.sessionValid(c) { return }
			if writeEvent(c, "changed", map[string]any{"refresh": true, "topic": topic}) != nil { return }
		}
	}
}
