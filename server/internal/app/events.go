package app

import (
	"encoding/json"
	"fmt"

	"github.com/gin-gonic/gin"
)

// Notifications only wake a reader; authoritative snapshots always come from SQLite.
func (a *App) subscribe(userID string) (<-chan string, func()) {
	ch := make(chan string, 1)
	a.eventsMu.Lock()
	if a.events[userID] == nil { a.events[userID] = map[chan string]bool{} }
	a.events[userID][ch] = true
	a.eventsMu.Unlock()
	return ch, func() {
		a.eventsMu.Lock()
		delete(a.events[userID], ch)
		if len(a.events[userID]) == 0 { delete(a.events, userID) }
		a.eventsMu.Unlock()
	}
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
	c.Writer.Flush()
	return err
}

func (a *App) sessionValid(c *gin.Context) bool {
	if a.siteAccess(currentUser(c)) != nil { return false }
	var count int64
	return a.db.Model(&Session{}).Where("hash = ? AND user_id IN (?)", c.GetString("session"), a.db.Model(&User{}).Select("id").Where("id = ? AND disabled = ?", currentUser(c).ID, false)).Count(&count).Error == nil && count == 1
}

func (a *App) userEvents(c *gin.Context) {
	updates, stop := a.subscribe(currentUser(c).ID)
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
	for {
		select {
		case <-c.Request.Context().Done(): return
		case topic := <-updates:
			if closed() { return }
			if !a.sessionValid(c) { return }
			if writeEvent(c, "changed", map[string]any{"refresh": true, "topic": topic}) != nil { return }
		}
	}
}
