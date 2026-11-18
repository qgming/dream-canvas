package app

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/fastschema/qjs"
	"github.com/openai/openai-go/v3/option"
	"github.com/openai/openai-go/v3/packages/ssestream"
)

// Builtin and user scripts share the same WASM runtime and host capabilities.
func (a *App) scriptRunner(parent context.Context, snapshot executionSnapshot, phase string) (runner func(string, any) (map[string]any, error), cleanup func(), failure error) {
	ctx, cancelCause := context.WithCancelCause(parent)
	cancel := func() { cancelCause(nil) }
	ctx = withLogContext(ctx, slog.String("phase", phase), slog.String("channel_id", snapshot.ChannelID), slog.String("model_id", snapshot.Model.ID), slog.String("script_version", snapshot.Model.AdapterVersionID), slog.Int("script_seconds", snapshot.Policy.ScriptSeconds), slog.Int("script_memory_mib", snapshot.Policy.ScriptMemoryMiB), slog.Int64("json_limit_bytes", snapshot.Policy.JSONBytes))
	started := time.Now()
	defer func() {
		if recovered := recover(); recovered != nil { failure = &scriptRuntimeError{stage: "脚本运行环境初始化", cause: fmt.Errorf("%v", recovered)}; cancel(); if cleanup != nil { cleanup() }; runner, cleanup = nil, nil }
		if failure != nil { a.logFailure(ctx, "script.runtime_failed", failure, slog.Int64("duration_ms", time.Since(started).Milliseconds())) }
	}()
	runtime, err := qjs.New(qjs.Option{Context: ctx, NoFilesystem: true, CloseOnContextDone: true, MemoryLimit: snapshot.Policy.ScriptMemoryMiB << 20, MemoryLimitPages: uint32(snapshot.Policy.ScriptMemoryMiB)*16, Stdout: io.Discard, Stderr: io.Discard})
	if err != nil { cancel(); return nil, nil, &scriptRuntimeError{stage: "脚本运行环境初始化", cause: err} }
	cleanup = func() { defer func() { recovered := recover(); cancel(); if recovered != nil { a.logFailure(ctx, "script.runtime_close_failed", fmt.Errorf("%v", recovered)) } }(); runtime.Close() }
	js := runtime.Context()
	js.SetFunc("$encode", func(this *qjs.This) (*qjs.Value, error) {
		args := this.Args(); if len(args) != 2 { return nil, errors.New("encode(kind, value) required") }; kind, value := args[0].String(), args[1].String()
		switch kind { case "base64": value = base64.StdEncoding.EncodeToString([]byte(value)); case "hex": value = hex.EncodeToString([]byte(value)); case "url": value = url.QueryEscape(value); case "sha256": sum := sha256.Sum256([]byte(value)); value = hex.EncodeToString(sum[:]); default: return nil, errors.New("unsupported encoding") }; return js.NewString(value), nil
	})
	js.SetFunc("$sign", func(this *qjs.This) (*qjs.Value, error) { args := this.Args(); if len(args) != 1 { return nil, errors.New("sign(value) required") }; secret, err := a.decryptSecret(snapshot.Credential); if err != nil { return nil, err }; mac := hmac.New(sha256.New, []byte(secret)); mac.Write([]byte(args[0].String())); return js.NewString(hex.EncodeToString(mac.Sum(nil))), nil })
	a.logEvent(ctx, slog.LevelDebug, "script.runtime_ready", slog.Int64("duration_ms", time.Since(started).Milliseconds()), slog.Uint64("memory_bytes", uint64(runtime.Mem().Size())))
	evaluations := 0
	run := func(source string, input any) (output map[string]any, err error) {
		started := time.Now(); evaluations++
		inputBytes, outputBytes := 0, 0
		defer func() {
			if recovered := recover(); recovered != nil { cause := fmt.Errorf("%v", recovered); if context.Cause(ctx) != nil { cause = fmt.Errorf("%w: %v", context.Cause(ctx), cause) }; if err == nil { output, err = nil, &scriptRuntimeError{stage: "脚本执行（中断或资源边界）", cause: cause} } }
			fields := []slog.Attr{slog.Int("evaluation", evaluations), slog.Int("input_bytes", inputBytes), slog.Int("output_bytes", outputBytes), slog.Uint64("memory_bytes", uint64(runtime.Mem().Size())), slog.Int64("duration_us", time.Since(started).Microseconds())}
			if err != nil { a.logFailure(ctx, "script.failed", err, fields...) } else { a.logEvent(ctx, slog.LevelDebug, "script.completed", fields...) }
		}()
		data, err := json.Marshal(input); if err != nil { return nil, err }; inputBytes = len(data); if int64(len(data)) > snapshot.Policy.JSONBytes { return nil, &scriptRuntimeError{stage: "脚本输入（超过 JSON 边界）"} }
		timer := time.AfterFunc(seconds(snapshot.Policy.ScriptSeconds), func() { cancelCause(context.DeadlineExceeded) }); defer timer.Stop()
		// QJS_Eval already awaits promises; its return value is the resolved JSON string.
		value, err := js.Eval("script.js", qjs.Code(`(async()=>{const run=async function(input,{encode,sign}){`+source+`};return JSON.stringify(await run(JSON.parse(`+strconv.Quote(string(data))+`),{encode:$encode,sign:$sign}));})()`)); if err != nil { return nil, &scriptRuntimeError{stage: "脚本执行", cause: err} }; defer value.Free()
		encoded := value.String(); outputBytes = len(encoded); if int64(len(encoded)) > snapshot.Policy.JSONBytes { return nil, &scriptRuntimeError{stage: "脚本输出（超过 JSON 边界）"} }
		if json.Unmarshal([]byte(encoded), &output) != nil || output == nil { return nil, &scriptRuntimeError{stage: "脚本输出（需要 JSON 对象）"} }; return output, nil
	}
	return run, cleanup, nil
}

func (a *App) runScript(ctx context.Context, snapshot executionSnapshot, phase, source string, input any) (map[string]any, error) {
	ctx, cancel := context.WithTimeout(ctx, seconds(snapshot.Policy.ScriptSeconds)); defer cancel()
	run, close, err := a.scriptRunner(ctx, snapshot, phase); if err != nil { return nil, err }; defer close(); return run(source, input)
}

func (a *App) scriptArguments(task GenerationTask, snapshot executionSnapshot, input generationInput, withFiles bool) (map[string]any, error) {
	var controls []parameterControl; if err := json.Unmarshal(snapshot.Model.Parameters, &controls); err != nil { return nil, err }
	parameters := map[string]any{}; if err := json.Unmarshal(input.Parameters, &parameters); err != nil { return nil, err }
	references := []map[string]any{}
	for _, reference := range input.References {
		var asset Asset; if err := a.db.First(&asset, "id = ? AND user_id = ?", reference.AssetID, task.UserID).Error; err != nil { return nil, err }
		for _, control := range materialControls(controls, parameters, reference) {
		row := map[string]any{"assetId": asset.ID, "role": reference.Role, "mimeType": asset.MimeType, "bytes": asset.Bytes, "width": asset.Width, "height": asset.Height, "durationMs": asset.DurationMS, "videoCodec": asset.VideoCodec, "audioCodec": asset.AudioCodec, "fps": asset.FPS}
		if reference.VoiceID != "" { row["voiceId"] = reference.VoiceID }
		transport := control.Transport; if transport == "" { transport = "https" }
		if control.Type == "asset" { row["parameterKey"] = control.Key }
		row["transport"] = transport
		if withFiles && transport == "https" { address, err := a.assetTaskURL(task.UserID, asset.ID, snapshot.Policy); if err != nil { return nil, err }; row["url"] = address }
		if withFiles && transport == "data" {
			if asset.Bytes > (snapshot.Policy.JSONBytes/4)*3 { return nil, problem(400, "asset_encoding_limit", "Base64 素材超过脚本 JSON 边界，请为此模型改用 file 或 https") }
			a.assetFiles.RLock(); name, err := a.assetPath(asset.Path); var data []byte
			if err == nil { var file *os.File; file, err = os.Open(name); if err == nil { data, err = io.ReadAll(io.LimitReader(file, asset.Bytes+1)); file.Close(); if int64(len(data)) != asset.Bytes { err = errors.New("asset size changed") } } }; a.assetFiles.RUnlock()
			if err != nil { return nil, err }; row["dataUrl"] = "data:"+asset.MimeType+";base64,"+base64.StdEncoding.EncodeToString(data)
		}
		references = append(references, row)
		}
	}
	messages := any([]any{}); if len(input.Messages) > 0 { messages = json.RawMessage(input.Messages) }
	images, videos, audios := []map[string]any{}, []map[string]any{}, []map[string]any{}
    for _, reference := range references { switch reference["role"] { case "image": images = append(images, reference); case "video": videos = append(videos, reference); case "audio": audios = append(audios, reference) } }
    return map[string]any{"prompt": input.Prompt, "messages": messages, "params": parameters, "model": snapshot.Model.Model, "upstreamId": task.UpstreamID, "images": images, "videos": videos, "audios": audios, "tools": []any{}}, nil
}

func (a *App) validateScriptInput(userID string, snapshot executionSnapshot, input generationInput, tools ...[]map[string]any) error {
	if snapshot.Script == nil { return problem(400, "script_required", "模型尚未选择接口脚本版本") }; scripts := map[string]string{}; if err := json.Unmarshal(snapshot.Script.Scripts, &scripts); err != nil { return err }; if scripts["validate"] == "" { return nil }
	arguments, err := a.scriptArguments(GenerationTask{UserID: userID}, snapshot, input, false); if err != nil { return err }
	if len(tools) > 0 { arguments["tools"] = tools[0] }
	value, err := a.runScript(a.ctx, snapshot, "validate", scripts["validate"], arguments); if err != nil { return problem(400, "interface_validation_failed", "参数校验阶段："+providerError(&scriptPreparationError{cause: err})) }
	if value["valid"] != true { message := text(value["error"]); if message == "" { message = "模型参数或素材组合不符合接口要求" }; return problem(400, "invalid_model_input", message) }; return nil
}

// Public diagnostics identify the failing stage without exposing script values or credentials.
type scriptRuntimeError struct { stage string; cause error }
func (e *scriptRuntimeError) Error() string { return e.stage+"失败，请核对接口脚本及已配置运行边界" }
func (e *scriptRuntimeError) Unwrap() error { return e.cause }

type scriptPreparationError struct { cause error }
func (e *scriptPreparationError) Error() string { return "接口脚本调用准备失败，尚未提交供应商" }
func (e *scriptPreparationError) Unwrap() error { return e.cause }

func scriptRequestURL(baseURL, requestPath string) (string, error) {
	address, err := url.Parse(requestPath); base, baseErr := url.Parse(strings.TrimRight(baseURL, "/")+"/")
	if err != nil || baseErr != nil || strings.TrimSpace(requestPath) == "" || base.Host == "" { return "", errors.New("invalid script request path") }
	resolved := base.ResolveReference(address)
	if resolved.Scheme != "https" || resolved.Host != base.Host || resolved.User != nil || resolved.Fragment != "" { return "", errors.New("script requests must stay on the channel origin") }
	return resolved.String(), nil
}

func (a *App) scriptRequest(ctx context.Context, task GenerationTask, leaseID string, snapshot executionSnapshot, descriptor map[string]any, arguments map[string]any, onStream func(map[string]any) error) (output map[string]any, failure error) {
	submitted := false
	started := time.Now()
	statusCode := 0
	responseType := text(descriptor["responseType"])
	loggedResponseType := responseType; if !includes([]string{"", "json", "binary", "image-json", "sse"}, responseType) { loggedResponseType = "invalid" }
	defer func() {
		fields := []slog.Attr{slog.Bool("submission_started", submitted), slog.String("response_type", loggedResponseType), slog.Int("http_status", statusCode), slog.Int64("duration_ms", time.Since(started).Milliseconds())}
		if failure != nil { a.logFailure(ctx, "provider.failed", failure, fields...); if !submitted { failure = &scriptPreparationError{cause: failure} } } else { a.logEvent(ctx, slog.LevelDebug, "provider.completed", fields...) }
	}()
	resolved, err := scriptRequestURL(snapshot.BaseURL, text(descriptor["path"])); if err != nil { return nil, err }
	client, err := a.providerClient(snapshot); if err != nil { return nil, err }
	method := strings.ToUpper(text(descriptor["method"])); if method == "" { method = "POST" }; if !includes([]string{"GET", "POST", "PUT", "PATCH", "DELETE"}, method) { return nil, errors.New("unsupported request method") }
	authHeader, _ := scriptAuth(snapshot)
	opts := []option.RequestOption{}
	for key, value := range object(descriptor["headers"]) { if !validHeaderName(key) || strings.EqualFold(key, authHeader) || includes([]string{"authorization", "cookie", "host", "content-length", "transfer-encoding", "connection", "x-api-key"}, strings.ToLower(key)) || strings.ContainsAny(text(value), "\r\n") { return nil, errors.New("credential and transport headers are host-managed") }; opts = append(opts, option.WithHeader(key, text(value))) }
	formats := 0; for _, key := range []string{"body", "form", "multipart"} { if descriptor[key] != nil { formats++ } }; if formats > 1 { return nil, errors.New("choose one request body, form or multipart") }
	body := descriptor["body"]; if raw, ok := body.(string); ok { body = strings.NewReader(raw) }
	if !includes([]string{"", "json", "binary", "image-json", "sse"}, responseType) { return nil, errors.New("unsupported response type") }
	if (responseType == "binary" || responseType == "image-json") && task.ID == "" { return nil, errors.New("media responses require a persistent generation task") }
	if len(array(descriptor["multipart"])) > 0 || responseType == "binary" || responseType == "image-json" { release, err := a.acquireFile(ctx, false, responseType == "binary" || responseType == "image-json"); if err != nil { return nil, err }; defer release() }
	if responseType == "binary" || responseType == "image-json" { transferCtx, cancel := context.WithTimeout(ctx, seconds(snapshot.Policy.TransferSeconds)); defer cancel(); ctx = transferCtx }
	if fields := object(descriptor["form"]); len(fields) > 0 { values := url.Values{}; for key, value := range fields { values.Set(key, text(value)) }; body = strings.NewReader(values.Encode()); opts = append(opts, option.WithHeader("Content-Type", "application/x-www-form-urlencoded")) }
	if parts := array(descriptor["multipart"]); len(parts) > 0 {
		a.assetFiles.RLock(); defer a.assetFiles.RUnlock(); reader, writer := io.Pipe(); form := multipart.NewWriter(writer); defer reader.Close()
		go func() { err := func() error {
			for _, raw := range parts { part := object(raw); field := text(part["name"]); if field == "" { return errors.New("multipart field name required") }
				if id := text(part["assetId"]); id != "" {
					var asset Asset; if err := a.db.Where("id = ? AND user_id = ? AND save_state = ? AND EXISTS (SELECT 1 FROM task_assets WHERE task_assets.task_id = ? AND task_assets.asset_id = assets.id AND released = ?)", id, task.UserID, "saved", leaseID, false).First(&asset).Error; err != nil { return err }
					name, err := a.assetPath(asset.Path); if err != nil { return err }; file, err := os.Open(name); if err != nil { return err }
					header := make(http.Header); header.Set("Content-Disposition", mime.FormatMediaType("form-data", map[string]string{"name": field, "filename": asset.Title})); header.Set("Content-Type", asset.MimeType)
					output, err := form.CreatePart(textproto.MIMEHeader(header)); if err == nil { _, err = io.Copy(output, file) }; file.Close(); if err != nil { return err }
				} else if err := form.WriteField(field, text(part["value"])); err != nil { return err }
			}; return form.Close()
		}(); writer.CloseWithError(err) }(); body = reader; opts = append(opts, option.WithHeader("Content-Type", form.FormDataContentType()))
	}
	submitted = true
	a.logEvent(ctx, slog.LevelDebug, "provider.request_started", slog.String("method", method), slog.String("response_type", responseType))
	var response *http.Response; if err := client.Execute(ctx, method, resolved, body, &response, opts...); err != nil { return nil, a.providerFailure(snapshot, err) }; defer response.Body.Close()
	statusCode = response.StatusCode
	a.logEvent(ctx, slog.LevelDebug, "provider.headers_received", slog.Int("http_status", statusCode), slog.Int64("duration_ms", time.Since(started).Milliseconds()))
	if response.StatusCode < 200 || response.StatusCode >= 300 { return nil, &providerRequestError{cause: errors.New("provider redirect"), message: "供应商返回 HTTP "+strconv.Itoa(response.StatusCode)+"，请检查完整 API Base URL；不会跟随重定向提交凭据"} }
	if task.ID != "" {
		updated := a.db.Model(&GenerationTask{}).Where("id = ? AND status = ? AND provider_status = ?", task.ID, "submitting", "").Update("provider_status", "running")
		if updated.Error != nil { return nil, updated.Error }; if updated.RowsAffected > 0 { a.notifyTopic(task.UserID, "tasks") }
	}
	if responseType == "sse" { return a.readScriptStream(ctx, snapshot, response, arguments, onStream) }
	if responseType == "image-json" { result, err := a.persistProviderResponse(task.ID, response.Body); return map[string]any{"responseFile": result.ResponseFile}, err }
	if responseType == "binary" {
		name := task.ID+".media"; directory := filepath.Join(a.root, "results"); if err := os.MkdirAll(directory, 0700); err != nil { return nil, err }; file, err := os.OpenFile(filepath.Join(directory, name+".pending"), os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0600); if err != nil { return nil, err }; defer os.Remove(file.Name())
		count, err := io.Copy(file, io.LimitReader(response.Body, snapshot.Policy.mediaLimit(task.Capability)+1)); if err == nil && (count == 0 || count > snapshot.Policy.mediaLimit(task.Capability)) { err = errors.New("binary output exceeds configured media boundary") }; if err == nil { err = file.Sync() }; closeErr := file.Close(); if err == nil { err = closeErr }; if err == nil { err = os.Rename(file.Name(), filepath.Join(directory, name)) }; if err != nil { return nil, err }; return map[string]any{"responseFile": name, "mimeType": response.Header.Get("Content-Type"), "bytes": count}, nil
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, snapshot.Policy.JSONBytes+1)); if err != nil { return nil, err }; if int64(len(data)) > snapshot.Policy.JSONBytes { return nil, errors.New("supplier JSON exceeds configured boundary") }
	var result any; if json.Unmarshal(data, &result) != nil { return nil, errors.New("supplier did not return valid JSON") }; if value, ok := result.(map[string]any); ok { return value, nil }; return map[string]any{"data": result}, nil
}

func (a *App) readScriptStream(ctx context.Context, snapshot executionSnapshot, response *http.Response, arguments map[string]any, onStream func(map[string]any) error) (output map[string]any, failure error) {
	scripts := map[string]string{}; _ = json.Unmarshal(snapshot.Script.Scripts, &scripts); if scripts["stream"] == "" { return nil, errors.New("script stream parser required") }
	run, close, err := a.scriptRunner(ctx, snapshot, "stream"); if err != nil { return nil, err }; defer close()
	stream := ssestream.NewDecoder(response); defer stream.Close(); state := map[string]any{}
	started := time.Now(); events := 0
	defer func() {
		fields := []slog.Attr{slog.Int("events", events), slog.Int("text_bytes", len(text(state["text"]))), slog.Int("reasoning_bytes", len(text(state["reasoning"]))), slog.Int("tool_calls", len(array(state["toolCalls"]))), slog.Bool("complete", state["complete"] == true), slog.Int64("duration_ms", time.Since(started).Milliseconds())}
		if failure != nil { a.logFailure(ctx, "provider.stream_failed", failure, fields...) } else { a.logEvent(ctx, slog.LevelDebug, "provider.stream_completed", fields...) }
	}()
	for stream.Next() {
		event := stream.Event(); data := strings.TrimSpace(string(event.Data)); if data == "" || data == "[DONE]" { continue }
		if int64(len(event.Data)) > snapshot.Policy.JSONBytes { return state, errors.New("stream event exceeds configured JSON boundary") }
		var value map[string]any; if json.Unmarshal(event.Data, &value) != nil || value == nil { return state, errors.New("invalid stream JSON") }; if value["type"] == nil && event.Type != "" { value["type"] = event.Type }
		events++
		next, err := run(scripts["stream"], map[string]any{"event": value, "state": state, "input": arguments}); if err != nil { return state, err }; state = next
		if _, err := scriptProgress(state); err != nil { return state, &scriptRuntimeError{stage: "流式进度字段（需要 0–100 数值）", cause: err} }
		if onStream != nil { if err := onStream(state); err != nil { return state, err } }
	}
	if err := stream.Err(); err != nil { return state, err }; if state["complete"] != true { return state, io.ErrUnexpectedEOF }; return state, nil
}

type scriptParseError struct { phase string; detail string; cause error }
func (e *scriptParseError) Error() string { if e.detail != "" { return e.detail+"；原响应已保留，未重新提交供应商" }; return "接口"+e.phase+"解析失败；原响应已保存，可继续解析，未重新提交供应商" }
func (e *scriptParseError) Unwrap() error { return e.cause }

func scriptProgress(value map[string]any) (*float64, error) {
	if value["progress"] == nil { return nil, nil }
	percent, ok := value["progress"].(float64)
	if !ok || percent < 0 || percent > 100 { return nil, errors.New("script progress requires a provider-reported number in [0,100]") }
	return &percent, nil
}

func (a *App) persistScriptResponse(taskID, phase string, response, arguments map[string]any) error {
	if taskID == "" { return nil }; if _, err := a.assetPath(taskID); err != nil { return err }
	name := taskID+".script.json"; directory := filepath.Join(a.root, "results"); if err := os.MkdirAll(directory, 0700); err != nil { return err }; file, err := os.OpenFile(filepath.Join(directory, taskID+".pending"), os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0600); if err != nil { return err }; defer os.Remove(file.Name())
	err = json.NewEncoder(file).Encode(map[string]any{"phase": phase, "response": response, "arguments": arguments}); if err == nil { err = file.Sync() }; closeErr := file.Close(); if err == nil { err = closeErr }; if err == nil { err = os.Rename(file.Name(), filepath.Join(directory, name)) }; if err != nil { return err }; return a.db.Model(&GenerationTask{}).Where("id = ?", taskID).Update("raw_response_file", name).Error
}

func (a *App) callModelScript(ctx context.Context, task GenerationTask, snapshot executionSnapshot, input generationInput, query bool) (providerResult, error) {
	arguments, err := a.scriptArguments(task, snapshot, input, task.RawResponseFile == ""); if err != nil { return providerResult{}, &scriptPreparationError{cause: err} }
	return a.executeModelScript(ctx, task, task.ID, snapshot, arguments, query, func(state map[string]any) error {
		values := map[string]any{}
		if content := text(state["text"]); task.Capability == "text" && content != task.Text { values["text"], task.Text = content, content }
		if progress, err := scriptProgress(state); err != nil { return err } else if progress != nil && (task.Progress == nil || *task.Progress != *progress) { values["progress"], task.Progress = progress, progress }
		if status := text(state["status"]); includes([]string{"queued", "running"}, status) && status != task.ProviderStatus { values["provider_status"], task.ProviderStatus = status, status }
		if len(values) == 0 { return nil }; if err := a.db.Model(&GenerationTask{}).Where("id = ?", task.ID).Updates(values).Error; err != nil { return err }; a.notifyTopic(task.UserID, "tasks"); return nil
	})
}

func (a *App) executeModelScript(ctx context.Context, task GenerationTask, leaseID string, snapshot executionSnapshot, arguments map[string]any, query bool, onStream func(map[string]any) error) (providerResult, error) {
	ctx = withLogContext(ctx, slog.String("channel_id", snapshot.ChannelID), slog.String("model_id", snapshot.Model.ID), slog.String("script_version", snapshot.Model.AdapterVersionID))
	if task.ID != "" { ctx = withLogContext(ctx, slog.String("task_id", task.ID)) }
	if task.RawResponseFile == "" {
		if snapshot.Script == nil { return providerResult{}, &scriptPreparationError{cause: errors.New("missing script version")} }
		if err := ctx.Err(); err != nil { return providerResult{}, &scriptPreparationError{cause: err} }
	}
	scripts := map[string]string{}; if snapshot.Script == nil || json.Unmarshal(snapshot.Script.Scripts, &scripts) != nil { return providerResult{}, errors.New("invalid script scripts") }
	phase := "submit"; if query { phase = "query" }; response := map[string]any{}
	if task.RawResponseFile != "" {
		if task.RawResponseFile != task.ID+".script.json" { return providerResult{}, errors.New("invalid saved response") }; file, err := os.Open(filepath.Join(a.root, "results", task.RawResponseFile)); if err != nil { return providerResult{}, err }
		var saved struct { Phase string `json:"phase"`; Response map[string]any `json:"response"`; Arguments map[string]any `json:"arguments"` }; err = json.NewDecoder(file).Decode(&saved); closeErr := file.Close(); if err != nil || closeErr != nil || saved.Response == nil || saved.Arguments == nil { return providerResult{}, errors.New("saved response unreadable") }; phase, response, arguments = saved.Phase, saved.Response, saved.Arguments
		if task.UpstreamID != "" { arguments["upstreamId"] = task.UpstreamID }
	} else {
		if scripts[phase] == "" { return providerResult{}, &scriptPreparationError{cause: errors.New("missing script phase")} }
		if query && task.CancelRequested && !task.CancelSent && scripts["cancel"] != "" {
			update := a.db.Model(&GenerationTask{}).Where("id = ? AND cancel_sent = ?", task.ID, false).Update("cancel_sent", true); if update.Error != nil { return providerResult{}, update.Error }
			if update.RowsAffected == 1 { descriptor, cancelErr := a.runScript(ctx, snapshot, "cancel", scripts["cancel"], arguments); if cancelErr == nil { _, cancelErr = a.scriptRequest(ctx, task, leaseID, snapshot, descriptor, arguments, nil) }; message := "已发送取消请求，继续核对实际结果和用量"; if cancelErr != nil { message = "取消结果待确认，不重复发送；继续查询实际结果" }; a.db.Model(&GenerationTask{}).Where("id = ?", task.ID).Update("cancel_error", message) }
		}
		descriptor, err := a.runScript(ctx, snapshot, phase, scripts[phase], arguments); if err != nil { return providerResult{}, &scriptPreparationError{cause: err} }
		response, err = a.scriptRequest(ctx, task, leaseID, snapshot, descriptor, arguments, onStream); if err != nil { result := providerResult{}; _ = json.Unmarshal(encode(response), &result); return result, err }
		if err := a.persistScriptResponse(task.ID, phase, response, arguments); err != nil { return providerResult{}, err }
	}
	for {
		if err := ctx.Err(); err != nil { return providerResult{}, err }
		parsed, err := a.runScript(ctx, snapshot, "result", scripts["result"], map[string]any{"response": response, "phase": phase, "input": arguments}); if err != nil { return providerResult{}, &scriptParseError{phase: "结果", cause: err} }
		if id := text(parsed["upstreamId"]); id != "" { arguments["upstreamId"] = id }
		if follow := object(parsed["request"]); len(follow) > 0 {
			if strings.ToUpper(text(follow["method"])) != "GET" { return providerResult{}, &scriptParseError{phase: "后续只读请求"} }
			if _, err := scriptProgress(parsed); err != nil { return providerResult{}, &scriptParseError{phase: "进度", detail: "接口脚本 progress 必须为供应商提供的 0–100 数值", cause: err} }
			previous := object(arguments["previousResult"]); for _, key := range []string{"usage", "usageState", "progress"} { if parsed[key] != nil { previous[key] = parsed[key] } }; arguments["previousResult"] = previous
			response, err = a.scriptRequest(ctx, task, leaseID, snapshot, follow, arguments, onStream); if err != nil { return providerResult{}, &scriptParseError{phase: "后续查询", cause: err} }; phase = "followup"; if err := a.persistScriptResponse(task.ID, phase, response, arguments); err != nil { return providerResult{}, err }; continue
		}
		if _, err := scriptProgress(parsed); err != nil { return providerResult{}, &scriptParseError{phase: "进度", detail: "接口脚本 progress 必须为供应商提供的 0–100 数值", cause: err} }
		var result providerResult; if json.Unmarshal(encode(parsed), &result) != nil || !includes([]string{"queued", "running", "completed", "incomplete", "failed", "cancelled", "confirmation_required"}, result.Status) { return result, &scriptParseError{phase: "结果状态"} }
		if result.Progress == nil { result.Progress, _ = scriptProgress(object(arguments["previousResult"])) }
		if result.UpstreamID == "" { result.UpstreamID = text(arguments["upstreamId"]) }
		if includes([]string{"queued", "running"}, result.Status) && (strings.TrimSpace(result.UpstreamID) == "" || scripts["query"] == "") { return result, &scriptParseError{phase: "查询依据", detail: "接口脚本 result 返回排队或运行状态，但缺少 upstreamId 或 query 阶段；请管理员核对响应编号映射"} }
		a.logEvent(ctx, slog.LevelDebug, "script.result_normalized", slog.String("status", result.Status), slog.Bool("has_upstream_id", result.UpstreamID != ""), slog.Bool("has_progress", result.Progress != nil))
		if result.ResponseFile != "" && result.ResponseFile != text(response["responseFile"]) { return providerResult{}, &scriptParseError{phase: "文件标识"} }
		if outputs := array(parsed["outputs"]); len(outputs) > 0 { if task.ID == "" { return providerResult{}, errors.New("media outputs require a persistent generation task") }; data := []map[string]any{}; for _, raw := range outputs { output := object(raw); if text(output["url"]) == "" && text(output["b64_json"]) == "" { return providerResult{}, &scriptParseError{phase: "成品"} }; data = append(data, map[string]any{"url": output["url"], "b64_json": output["b64_json"]}) }; saved, err := a.persistProviderResponse(task.ID, io.NopCloser(strings.NewReader(string(encode(map[string]any{"data": data}))))); if err != nil { return providerResult{}, err }; result.ResponseFile = saved.ResponseFile }
		if result.UsageState != "" { result.UsageState = normalizedUsageState(result.UsageState) }
		if scripts["usage"] != "" { usage, err := a.runScript(ctx, snapshot, "usage", scripts["usage"], map[string]any{"response": response, "input": arguments}); if err != nil { result.Usage, result.UsageState, result.Error = nil, "unknown", "用量解析失败，结果保留；请按供应商账单修正统计" } else { result.Usage = usage } }
		if result.Usage == nil { result.Usage = map[string]any{} }
		result.Usage["requests"] = 1
		return result, nil
	}
}

