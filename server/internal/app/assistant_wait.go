package app

import "encoding/json"

type taskWaitResult struct {
	Ready bool `json:"ready"`
	TaskIDs []string `json:"taskIds"`
	Tasks []GenerationTask `json:"tasks"`
}

func (a *App) WaitTasks(p Principal, ids []string) (taskWaitResult, error) {
	result := taskWaitResult{Ready: true, TaskIDs: []string{}, Tasks: []GenerationTask{}}
	if len(ids) == 0 { return result, problem(400, "invalid_tasks", "请提供至少一个生成任务编号") }
	for _, id := range ids {
		if id == "" { return result, problem(400, "invalid_tasks", "生成任务编号不能为空") }
		if includes(result.TaskIDs, id) { continue }
		var task GenerationTask
		if err := a.db.First(&task, "id = ? AND user_id = ?", id, p.User.ID).Error; err != nil { return result, err }
		if !p.allows("read", task.ProjectID) { return result, problem(403, "project_scope", "任务不在授权项目或本轮目标范围内") }
		result.TaskIDs = append(result.TaskIDs, id); result.Tasks = append(result.Tasks, task)
		if !terminalTask(task.Status) && task.Status != "confirmation_required" { result.Ready = false }
	}
	return result, nil
}

func (a *App) assistantTasksReady(turn AssistantTurn) bool {
	var snapshot assistantSnapshot
	if json.Unmarshal(turn.Snapshot, &snapshot) != nil || len(snapshot.WaitingTaskIDs) == 0 { return true }
	result, err := a.WaitTasks(Principal{User: User{ID: turn.UserID}, Scopes: []string{"read"}, FixedProject: true, TargetProjectID: turn.ProjectID}, snapshot.WaitingTaskIDs)
	return err != nil || result.Ready
}
