package app

import (
	"encoding/json"
	"math"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const maxUserClients = 16
const clientOfflineTTL = 10 * time.Minute

type onlineClient struct {
	ID string `json:"id"`
	UserID string `json:"-"`
	ProjectID string `json:"projectId"`
	Title string `json:"title"`
	Revision uint64 `json:"revision"`
	Registration uint64 `json:"registration"`
	Selected []string `json:"selectedNodeIds"`
	Nodes []string `json:"nodeIds"`
	Viewport map[string]float64 `json:"viewport"`
	connection string
	lastSeen time.Time
}

type clientRegistry struct { sync.Mutex; entries map[string]onlineClient }

type ClientCommand struct {
	ID string `json:"id" gorm:"primaryKey"`
	UserID string `json:"-" gorm:"index"`
	ClientID string `json:"clientId" gorm:"index"`
	ProjectID string `json:"projectId"`
	Revision uint64 `json:"revision"`
	Kind string `json:"kind"`
	Value JSON `json:"value" gorm:"type:blob"`
	Status string `json:"status"`
	Error string `json:"error,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func validViewport(viewport map[string]float64) bool {
	if len(viewport) != 3 || viewport["k"] <= 0 { return false }
	for _, key := range []string{"x", "y", "k"} { value, ok := viewport[key]; if !ok || math.IsNaN(value) || math.IsInf(value, 0) { return false } }; return true
}

func (a *App) pruneClientsLocked(userID string, now time.Time) {
	for id, entry := range a.clients.entries {
		if entry.UserID == userID && entry.connection == "" && !entry.lastSeen.IsZero() && now.Sub(entry.lastSeen) > clientOfflineTTL {
			delete(a.clients.entries, id)
		}
	}
}

func (a *App) saveClient(c *gin.Context) {
	var input onlineClient; if !bind(c, &input) { return }
	if _, err := a.assetPath(input.ID); err != nil || input.Revision == 0 || input.Registration == 0 || !validViewport(input.Viewport) { respondError(c, problem(400, "invalid_client", "客户端编号、版本或视口不正确")); return }
	if _, err := a.GetProject(currentUser(c).ID, input.ProjectID); err != nil { respondError(c, err); return }
	input.UserID = currentUser(c).ID
	now := time.Now()
	a.clients.Lock()
	a.pruneClientsLocked(input.UserID, now)
	previous, exists := a.clients.entries[input.ID]
	if exists && (previous.UserID != input.UserID || previous.Registration > input.Registration || previous.Revision > input.Revision || previous.Registration == input.Registration && previous.Revision == input.Revision && string(encode(previous)) != string(encode(input))) { a.clients.Unlock(); respondError(c, problem(409, "client_changed", "客户端状态已更新")); return }
	if !exists {
		count := 0
		oldestOfflineID := ""
		var oldestOfflineTime time.Time
		for id, entry := range a.clients.entries {
			if entry.UserID != input.UserID { continue }
			count++
			if entry.connection == "" && (oldestOfflineID == "" || entry.lastSeen.Before(oldestOfflineTime)) {
				oldestOfflineID, oldestOfflineTime = id, entry.lastSeen
			}
		}
		if count >= maxUserClients {
			if oldestOfflineID != "" {
				delete(a.clients.entries, oldestOfflineID)
			} else {
				a.clients.Unlock()
				respondError(c, problem(429, "too_many_clients", "当前账号在线页面过多，请关闭多余标签页后重试"))
				return
			}
		}
	}
	if previous.Registration == input.Registration { input.connection = previous.connection }
	input.lastSeen = now
	a.clients.entries[input.ID] = input
	a.clients.Unlock(); c.Status(204)
}

func (a *App) removeClient(c *gin.Context) {
	id, userID := c.Param("id"), currentUser(c).ID
	var input struct { Registration uint64 `json:"registration"` }; if !bind(c, &input) { return }
	a.clients.Lock(); client, ok := a.clients.entries[id]; if !ok || client.UserID != userID || client.Registration != input.Registration { a.clients.Unlock(); c.Status(204); return }; delete(a.clients.entries, id); defer a.clients.Unlock()
	if err := a.db.Model(&ClientCommand{}).Where("client_id = ? AND user_id = ? AND status = ?", id, userID, "pending").Updates(map[string]any{"status": "interrupted", "error": "客户端已离线，页面操作未确认"}).Error; err != nil { respondError(c, err); return }; c.Status(204)
}

// Online means an authenticated SSE connection exists; no guessed heartbeat expiry is used.
func (a *App) clientEvents(c *gin.Context) {
	id, userID, connection := c.Param("id"), currentUser(c).ID, identifier()
	registration := c.Query("registration")
	a.clients.Lock(); client, exists := a.clients.entries[id]; a.clients.Unlock()
	if !exists || client.UserID != userID || text(client.Registration) != registration { respondError(c, problem(404, "client_missing", "客户端尚未注册或连接已更新")); return }
	updates, stop, err := a.subscribe(userID)
	if err != nil { respondError(c, err); return }
	defer stop()
	a.clients.Lock()
	client, exists = a.clients.entries[id]
	if !exists || client.UserID != userID || text(client.Registration) != registration { a.clients.Unlock(); respondError(c, problem(404, "client_missing", "客户端尚未注册或连接已更新")); return }
	client.connection = connection
	client.lastSeen = time.Now()
	a.clients.entries[id] = client
	a.clients.Unlock()
	defer func() {
		a.clients.Lock(); defer a.clients.Unlock()
		if current, ok := a.clients.entries[id]; ok && current.Registration == client.Registration && current.connection == connection {
			current.connection = ""
			current.lastSeen = time.Now()
			a.clients.entries[id] = current
			a.db.Model(&ClientCommand{}).Where("client_id = ? AND user_id = ? AND status = ?", id, userID, "pending").Updates(map[string]any{"status": "interrupted", "error": "客户端已离线，页面操作未确认"})
		}
	}()
	c.Header("Content-Type", "text/event-stream"); c.Header("X-Accel-Buffering", "no")
	heartbeat := time.NewTicker(sseHeartbeatInterval)
	defer heartbeat.Stop()
	for {
		if !a.sessionValid(c) { return }
		a.clients.Lock(); current, exists := a.clients.entries[id]; a.clients.Unlock(); if !exists || current.connection != connection { return }
		commands := []ClientCommand{}; if err := a.db.Where("client_id = ? AND user_id = ? AND status = ?", id, userID, "pending").Order("created_at").Find(&commands).Error; err != nil { return }
		if writeEvent(c, "commands", commands) != nil { return }
		select {
		case <-c.Request.Context().Done(): return
		case <-heartbeat.C:
			if !a.sessionValid(c) || writeHeartbeat(c) != nil { return }
		case <-updates:
		}
	}
}

func (a *App) acknowledgeClient(c *gin.Context) {
	var input struct { Accepted bool `json:"accepted"`; ProjectID string `json:"projectId"` }; if !bind(c, &input) { return }
	status, message := "applied", ""; if !input.Accepted { status, message = "rejected", "页面状态已改变或操作无法执行，未应用页面操作" }
	query := a.db.Model(&ClientCommand{}).Where("id = ? AND client_id = ? AND user_id = ?", c.Param("commandId"), c.Param("id"), currentUser(c).ID)
	if input.ProjectID != "" { if _, err := a.GetProject(currentUser(c).ID, input.ProjectID); err != nil { respondError(c, err); return }; query = query.Where("kind = ? AND json_extract(value, '$.projectId') = ? AND status IN ?", "client_navigate", input.ProjectID, []string{"pending", "interrupted"}) } else { query = query.Where("status = ?", "pending") }
	result := query.Updates(map[string]any{"status": status, "error": message})
	if result.Error != nil { respondError(c, result.Error); return }; a.notifyTopic(currentUser(c).ID, "clients"); c.Status(204)
}

func (a *App) clientBusiness(p Principal, name string, input map[string]any) (any, error) {
	a.clients.Lock(); defer a.clients.Unlock()
	if name == "clients_list" {
		rows := []onlineClient{}; for _, client := range a.clients.entries { if client.UserID == p.User.ID && client.connection != "" && p.allows("read", client.ProjectID) && (!p.FixedProject || p.ClientID == client.ID) { rows = append(rows, client) } }; return rows, nil
	}
	if name == "client_command_get" {
		var command ClientCommand; if err := a.db.First(&command, "id = ? AND user_id = ?", text(input["commandId"]), p.User.ID).Error; err != nil { return nil, err }; if !p.allows("read", command.ProjectID) || p.FixedProject && command.ClientID != p.ClientID { return nil, problem(403, "client_scope", "操作不在授权项目或绑定客户端范围内") }; return command, nil
	}
	client, exists := a.clients.entries[text(input["clientId"])]
	if p.FixedProject && (p.ClientID == "" || p.ClientID != client.ID) { return nil, problem(403, "client_scope", "本轮未绑定此客户端，不能改用其他在线页面") }
	if !exists || client.connection == "" || client.UserID != p.User.ID { return nil, problem(409, "client_offline", "明确指定的客户端未在线，不能读取选区或执行页面操作") }
	if !p.allows("read", client.ProjectID) || name != "client_get" && !p.allows("edit", client.ProjectID) { return nil, problem(403, "client_scope", "客户端不在授权项目范围内") }
	if name == "client_get" { return client, nil }
	if text(input["revision"]) != text(client.Revision) { return nil, problem(409, "client_changed", "客户端状态已改变，请重新读取后操作") }
	value := map[string]any{}
	switch name {
	case "client_select":
		ids := array(input["nodeIds"]); for _, id := range ids { if !includes(client.Nodes, text(id)) { return nil, problem(409, "node_missing", "节点不在此客户端当前画布中") } }; value["nodeIds"] = ids
	case "client_viewport":
		var viewport map[string]float64; if json.Unmarshal(encode(input["viewport"]), &viewport) != nil || !validViewport(viewport) { return nil, problem(400, "invalid_viewport", "视口需要有限的 x、y 及正数 k") }; value["viewport"] = viewport
	case "client_navigate":
		projectID := text(input["projectId"]); if !p.allows("read", projectID) || !p.allows("edit", projectID) { return nil, problem(403, "project_scope", "目标项目不在授权范围内") }; if _, err := a.GetProject(p.User.ID, projectID); err != nil { return nil, err }; value["projectId"] = projectID
	default: return nil, problem(404, "unknown_tool", "不支持的客户端操作")
	}
	command := ClientCommand{ID: identifier(), UserID: p.User.ID, ClientID: client.ID, ProjectID: client.ProjectID, Revision: client.Revision, Kind: name, Value: encode(value), Status: "pending"}
	err := a.db.Transaction(func(tx *gorm.DB) error { var count int64; if err := tx.Model(&ClientCommand{}).Where("client_id = ? AND user_id = ? AND status = ?", client.ID, p.User.ID, "pending").Count(&count).Error; err != nil { return err }; if count > 0 { return problem(409, "client_busy", "客户端仍有待确认的页面操作，请先查询其状态") }; return tx.Create(&command).Error })
	if err == nil { a.notifyTopic(p.User.ID, "clients") }; return command, err
}
