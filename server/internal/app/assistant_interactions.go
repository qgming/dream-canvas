package app

import (
	"encoding/json"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const assistantWaitingUser = "waiting_user"

type assistantQuestion struct {
	Question string `json:"question"`
	Options []string `json:"options,omitempty"`
}

type assistantAnswerInput struct {
	QuestionID string `json:"questionId"`
	Answer string `json:"answer"`
}

type assistantTodo struct {
	ID string `json:"id"`
	Text string `json:"text"`
	Status string `json:"status"`
}

func assistantInteractionTools() []toolDefinition {
	return []toolDefinition{
		{"ask_user", "当前信息不足以安全继续时，向用户提出一个明确问题，可给出选项，也允许自由回答。单独调用；回复之前本轮暂停，不用于索取凭据或操作审批。", "assistant", toolSchema(map[string]any{
			"question": stringField("需要用户回答的问题"),
			"options": map[string]any{"type": "array", "items": stringField("选项"), "uniqueItems": true},
		}, "question")},
		{"update_todos", "保存本轮任务待办清单，复杂工作按实际进展更新，同一事项保留 ID。传完整列表；完成须有实际依据，不能把已提交尚未完成的任务标为完成。", "assistant", toolSchema(map[string]any{
			"todos": map[string]any{"type": "array", "minItems": 1, "items": toolSchema(map[string]any{
				"id": stringField("本轮内唯一且稳定的事项 ID"), "text": stringField("事项"),
				"status": map[string]any{"type": "string", "enum": []string{"pending", "in_progress", "completed"}},
			}, "id", "text", "status")},
		}, "todos")},
	}
}

func parseAssistantQuestion(arguments map[string]any) (assistantQuestion, error) {
	var question assistantQuestion
	invalid := problem(400, "invalid_tool_arguments", "请填写问题；如提供选项，每项须非空且不能重复")
	if json.Unmarshal(encode(arguments), &question) != nil { return question, invalid }
	question.Question = strings.TrimSpace(question.Question)
	if question.Question == "" { return question, invalid }
	seen := map[string]bool{}
	for index, option := range question.Options {
		option = strings.TrimSpace(option)
		if option == "" || seen[option] { return question, invalid }
		question.Options[index], seen[option] = option, true
	}
	return question, nil
}

func parseAssistantTodos(arguments map[string]any) ([]assistantTodo, error) {
	var input struct { Todos []assistantTodo `json:"todos"` }
	invalid := problem(400, "invalid_tool_arguments", "待办须提供非空事项、唯一编号及有效状态")
	if json.Unmarshal(encode(arguments), &input) != nil || len(input.Todos) == 0 { return nil, invalid }
	seen := map[string]bool{}
	for index := range input.Todos {
		todo := &input.Todos[index]
		todo.ID, todo.Text = strings.TrimSpace(todo.ID), strings.TrimSpace(todo.Text)
		if todo.ID == "" || todo.Text == "" || seen[todo.ID] || !includes([]string{"pending", "in_progress", "completed"}, todo.Status) { return nil, invalid }
		seen[todo.ID] = true
	}
	return input.Todos, nil
}

func (a *App) answerAssistantTurn(c *gin.Context) {
	var input assistantAnswerInput
	if !bind(c, &input) { return }
	turn, err := a.AnswerAssistantTurn(currentUser(c), c.Param("id"), input)
	if err != nil { respondError(c, err); return }
	c.JSON(202, turn)
}

func (a *App) AnswerAssistantTurn(user User, turnID string, input assistantAnswerInput) (AssistantTurn, error) {
	var turn AssistantTurn
	answer := strings.TrimSpace(input.Answer)
	if answer == "" || strings.TrimSpace(input.QuestionID) == "" { return turn, problem(400, "assistant_answer_required", "请选择选项或填写回答") }
	changed := problem(409, "assistant_question_changed", "该问题已回答或不再等待，请重新读取会话")
	err := a.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.First(&turn, "id = ? AND user_id = ?", turnID, user.ID).Error; err != nil { return err }
		if turn.Status != assistantWaitingUser || turn.CancelRequested { return changed }
		var snapshot assistantSnapshot
		if json.Unmarshal(turn.Snapshot, &snapshot) != nil { return problem(409, "invalid_history", "轮次快照无法读取，未恢复执行") }
		if snapshot.WaitingQuestionID != input.QuestionID { return changed }
		item := AssistantItem{}
		if err := tx.First(&item, "thread_id = ? AND turn_id = ? AND id = ? AND user_id = ? AND role = ?", turn.ThreadID, turn.ID, input.QuestionID, user.ID, "tool").Error; err != nil { return err }
		detail := objectFromJSON(item.Detail)
		if detail["kind"] != "question" || detail["status"] != "waiting" { return changed }
		body := string(encode(map[string]any{"status": "answered", "answer": answer}))
		matched := false
		for index := len(snapshot.Messages)-1; index >= 0; index-- {
			message := snapshot.Messages[index]
			if message["role"] == "tool" && message["tool_call_id"] == item.ID {
				message["content"], matched = body, true
				break
			}
		}
		if !matched { return problem(409, "invalid_history", "提问的模型记录无法读取，未恢复执行") }
		snapshot.WaitingQuestionID = ""
		encoded := encode(snapshot)
		result := tx.Model(&turn).Where("status = ? AND cancel_requested = ?", assistantWaitingUser, false).Updates(map[string]any{"status": "queued", "snapshot": encoded, "error": ""})
		if result.Error != nil { return result.Error }
		if result.RowsAffected != 1 { return changed }
		detail["status"], detail["answer"] = "answered", answer
		if err := tx.Model(&item).Updates(map[string]any{"text": body, "detail": encode(detail)}).Error; err != nil { return err }
		turn.Status, turn.Snapshot, turn.Error = "queued", encoded, ""
		return nil
	})
	if err == nil { a.notify(user.ID); a.signalWork() }
	return turn, err
}

func assistantInteractionView(detail map[string]any, turnStatus string, redact func(string) string) (JSON, bool) {
	switch detail["kind"] {
	case "question":
		status := text(detail["status"])
		if status == "waiting" && turnStatus != assistantWaitingUser && turnStatus != "running" { status = "closed" }
		view := map[string]any{"kind": "question", "status": status, "question": redact(text(detail["question"]))}
		if options := array(detail["options"]); len(options) > 0 {
			labels := make([]string, 0, len(options))
			for _, option := range options { labels = append(labels, redact(text(option))) }
			view["options"] = labels
		}
		if status == "answered" { view["answer"] = redact(text(detail["answer"])) }
		return encode(view), true
	case "todo":
		var todos []assistantTodo
		_ = json.Unmarshal(encode(detail["todos"]), &todos)
		for index := range todos { todos[index].ID = digest(todos[index].ID); todos[index].Text = redact(todos[index].Text) }
		return encode(map[string]any{"kind": "todo", "todos": todos}), true
	case "context":
		status := text(detail["status"])
		if status == "running" && turnStatus != "running" { status = "failed" }
		return encode(map[string]any{"kind": "context", "status": status}), true
	default:
		return nil, false
	}
}
