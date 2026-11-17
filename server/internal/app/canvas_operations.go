package app

import "encoding/json"

func canvasTools() []toolDefinition {
	object := func(description string) map[string]any { return map[string]any{"type": "object", "description": description} }
	return []toolDefinition{{"canvas_apply_ops", "在服务端按项目版本原子编辑节点与连线；无需在线浏览器。读取 project_get 后传完整新增节点（id/type/title/position/width/height/metadata）；更新 patch 合并 metadata，删除节点仅解除资产引用；失败不保存任何操作", "edit", toolSchema(map[string]any{
		"projectId": stringField("明确的目标项目 ID"), "version": numberField("读取到的项目版本"),
		"ops": map[string]any{"type": "array", "minItems": 1, "items": toolSchema(map[string]any{
			"type": map[string]any{"type": "string", "enum": []string{"add_node", "update_node", "delete_node", "connect_nodes", "delete_connection"}},
			"node": object("add_node 的完整节点，类型支持 text/image/video/audio/config/group 和已安装的画布节点插件"),
			"id": stringField("update_node/delete_node/delete_connection 的明确编号；connect_nodes 可选连线编号"),
			"patch": object("update_node 的 title、position、width、height、metadata；metadata 按字段合并，null 清除字段，保留其他参数与内容"),
			"fromNodeId": stringField("connect_nodes 的起点节点 ID"), "toNodeId": stringField("connect_nodes 的终点节点 ID"),
		}, "type")},
	}, "projectId", "version", "ops")}}
}

func (a *App) ApplyCanvasOperations(p Principal, input map[string]any) (Project, error) {
	var request struct { ProjectID string `json:"projectId"`; Version uint64 `json:"version"`; Ops []struct { Type string `json:"type"`; Node map[string]any `json:"node"`; ID string `json:"id"`; Patch map[string]any `json:"patch"`; From string `json:"fromNodeId"`; To string `json:"toNodeId"` } `json:"ops"` }
	if json.Unmarshal(encode(input), &request) != nil || len(request.Ops) == 0 { return Project{}, problem(400, "invalid_operations", "请提供有效的节点或连线操作") }
	project, err := a.GetProject(p.User.ID, request.ProjectID); if err != nil { return project, err }
	if project.Version != request.Version { return project, problem(409, "version_conflict", "项目已更新，请重新读取后编辑节点") }
	var document map[string]any; if json.Unmarshal(project.Document, &document) != nil { return project, problem(409, "invalid_document", "项目内容无法读取") }
	nodes, connections := array(document["nodes"]), array(document["connections"])
	find := func(rows []any, id string) int { for index, raw := range rows { if object(raw)["id"] == id { return index } }; return -1 }
	for _, op := range request.Ops {
		switch op.Type {
		case "add_node":
			if op.Node == nil || text(op.Node["id"]) == "" || find(nodes, text(op.Node["id"])) >= 0 { return project, problem(400, "invalid_node", "新增节点需要完整内容与不重复的编号") }
			nodes = append(nodes, op.Node)
		case "update_node":
			index := find(nodes, op.ID); if index < 0 { return project, problem(404, "node_missing", "要修改的节点不存在") }
			if op.Patch == nil { return project, problem(400, "invalid_node_patch", "请提供节点修改内容") }
			node := object(nodes[index])
			for key, value := range op.Patch {
				if !includes([]string{"title", "position", "width", "height", "metadata"}, key) { return project, problem(400, "invalid_node_patch", "节点修改仅支持名称、位置、尺寸和 metadata") }
				if key == "metadata" { patch, ok := value.(map[string]any); if !ok { return project, problem(400, "invalid_node_patch", "metadata 需要对象") }; metadata := object(node["metadata"]); for name, value := range patch { if value == nil { delete(metadata, name) } else { metadata[name] = value } }; node[key] = metadata
				} else { node[key] = value }
			}
		case "delete_node":
			index := find(nodes, op.ID); if index < 0 { return project, problem(404, "node_missing", "要删除的节点不存在") }
			nodes = append(nodes[:index], nodes[index+1:]...)
			kept := []any{}; for _, raw := range connections { connection := object(raw); if connection["fromNodeId"] != op.ID && connection["toNodeId"] != op.ID { kept = append(kept, raw) } }; connections = kept
			for _, raw := range nodes { metadata := object(object(raw)["metadata"]); if metadata["groupId"] == op.ID { delete(metadata, "groupId") } }
		case "connect_nodes":
			if find(nodes, op.From) < 0 || find(nodes, op.To) < 0 { return project, problem(400, "node_missing", "连线起点或终点不存在") }
			for _, raw := range connections { connection := object(raw); if connection["fromNodeId"] == op.From && connection["toNodeId"] == op.To { return project, problem(409, "connection_exists", "节点之间已存在该方向连线") } }
			id := op.ID; if id == "" { id = identifier() }; if find(connections, id) >= 0 { return project, problem(409, "connection_exists", "连线编号重复") }
			connections = append(connections, map[string]any{"id": id, "fromNodeId": op.From, "toNodeId": op.To})
		case "delete_connection":
			index := find(connections, op.ID); if index < 0 { return project, problem(404, "connection_missing", "要删除的连线不存在") }; connections = append(connections[:index], connections[index+1:]...)
		default: return project, problem(400, "invalid_operations", "不支持的节点或连线操作")
		}
	}
	document["nodes"], document["connections"] = nodes, connections
	refs, err := validateDocument(encode(document)); if err != nil { return project, err }; for _, id := range refs { if err := a.checkTokenAsset(p, id); err != nil { return project, err } }
	return a.SaveProject(p.User.ID, project.ID, projectInput{Title: project.Title, Version: request.Version, Document: encode(document)})
}
