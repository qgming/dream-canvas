package app

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	openai "github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/option"
)

type executionSnapshot struct {
	ChannelID string `json:"channelId"`
	ChannelVersion uint64 `json:"channelVersion"`
	BaseURL string `json:"baseUrl"`
	Credential string `json:"credential"`
	Model ChannelModel `json:"model"`
	Script *ScriptVersion `json:"script"`
	Policy executionPolicy `json:"policy"`
}

type providerResult struct {
	UpstreamID string `json:"upstreamId,omitempty"`
	Status string `json:"status"`
	Progress *float64 `json:"progress,omitempty"`
	Text string `json:"text,omitempty"`
	URL string `json:"url,omitempty"`
	ResponseFile string `json:"responseFile,omitempty"`
	MimeType string `json:"mimeType,omitempty"`
	Usage map[string]any `json:"usage,omitempty"`
	UsageState string `json:"usageState,omitempty"`
	Reasoning string `json:"reasoning,omitempty"`
	ToolCalls []map[string]any `json:"toolCalls,omitempty"`
	ResponseItems []map[string]any `json:"responseItems,omitempty"`
	Error string `json:"error,omitempty"`
}

func object(value any) map[string]any { result, _ := value.(map[string]any); if result == nil { return map[string]any{} }; return result }
func text(value any) string { if value == nil { return "" }; return fmt.Sprint(value) }
func array(value any) []any { switch result := value.(type) { case []any: return result; case []map[string]any: list := make([]any, len(result)); for index := range result { list[index] = result[index] }; return list }; return nil }

func externalTransport(policy executionPolicy) *http.Transport {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.TLSHandshakeTimeout = seconds(policy.ConnectSeconds)
	transport.DisableKeepAlives = true
	transport.ResponseHeaderTimeout = seconds(policy.FirstResponseSeconds)
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil { return nil, err }
		addresses, err := net.DefaultResolver.LookupIPAddr(ctx, host)
		if err != nil { return nil, err }
		if len(addresses) == 0 { return nil, errors.New("provider hostname has no public address") }
		for _, address := range addresses { if !address.IP.IsGlobalUnicast() || address.IP.IsPrivate() || address.IP.IsLoopback() || address.IP.IsLinkLocalUnicast() { return nil, problem(400, "private_address", "供应商及素材地址必须指向公网 HTTPS 服务") } }
		var last error
		for _, address := range addresses { connection, err := (&net.Dialer{Timeout: seconds(policy.ConnectSeconds)}).DialContext(ctx, network, net.JoinHostPort(address.IP.String(), port)); if err == nil { return connection, nil }; last = err }
		return nil, last
	}
	return transport
}

type watchedBody struct { io.ReadCloser; timer *time.Timer; idle time.Duration; cancel context.CancelFunc; once sync.Once }
func (b *watchedBody) Read(data []byte) (int, error) { n, err := b.ReadCloser.Read(data); if n > 0 { b.timer.Reset(b.idle) }; return n, err }
func (b *watchedBody) Close() error { b.once.Do(func() { b.timer.Stop(); b.cancel() }); return b.ReadCloser.Close() }
type providerTransport struct { base http.RoundTripper; idle time.Duration }
func (t providerTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	ctx, cancel := context.WithCancel(request.Context())
	response, err := t.base.RoundTrip(request.Clone(ctx))
	if err != nil { cancel(); return nil, err }
	response.Body = &watchedBody{ReadCloser: response.Body, timer: time.AfterFunc(t.idle, cancel), idle: t.idle, cancel: cancel}
	return response, nil
}

func providerHTTP(policy executionPolicy) *http.Client {
	return &http.Client{Transport: providerTransport{base: externalTransport(policy), idle: seconds(policy.IdleSeconds)}, CheckRedirect: func(request *http.Request, via []*http.Request) error {
		if request.URL.Scheme != "https" || request.URL.User != nil { return errors.New("redirect must use HTTPS") }
		if len(via) > 0 && request.URL.Host != via[0].URL.Host { request.Header.Del("Authorization") }
		return http.ErrUseLastResponse
	}}
}

func (a *App) providerClient(snapshot executionSnapshot) (openai.Client, error) {
	credential, err := a.decryptSecret(snapshot.Credential)
	if err != nil { return openai.Client{}, err }
	header, prefix := scriptAuth(snapshot)
	opts := []option.RequestOption{option.WithAPIKey(""), option.WithHeaderDel("Authorization"), option.WithHeaderDel("OpenAI-Organization"), option.WithHeaderDel("OpenAI-Project"), option.WithBaseURL(strings.TrimRight(snapshot.BaseURL, "/")+"/"), option.WithMaxRetries(0), option.WithRequestTimeout(0), option.WithHTTPClient(providerHTTP(snapshot.Policy))}
	if header != "" { opts = append(opts, option.WithHeader(header, prefix+credential)) }
	return openai.NewClient(opts...), nil
}

func providerError(err error) string {
	var preparation *scriptPreparationError
	if errors.As(err, &preparation) { var runtime *scriptRuntimeError; if errors.As(err, &runtime) { return runtime.Error()+"；尚未提交供应商" }; return "接口请求映射或素材准备失败，尚未提交供应商；请管理员使用请求预览核对路径、参数与素材" }
	var request *providerRequestError; if errors.As(err, &request) { return request.Error() }
	var runtime *scriptRuntimeError; if errors.As(err, &runtime) { return runtime.Error()+"；请保留任务记录核对已经收到的响应" }
	var apiError *openai.Error
	if errors.As(err, &apiError) { return fmt.Sprintf("供应商返回 HTTP %d，请核对模型、参数、权限和供应商账单", apiError.StatusCode) }
	if errors.Is(err, context.Canceled) { return "调用已停止；请求可能已提交，结果与用量仍待确认" }
	if errors.Is(err, context.DeadlineExceeded) { return "调用超过已配置时限，结果与用量待确认，不会自动重新生成" }
	return "供应商连接或响应读取失败，结果与用量待确认；请保留任务记录核对"
}

type providerRequestError struct { cause error; message string }
func (e *providerRequestError) Error() string { return e.message }
func (e *providerRequestError) Unwrap() error { return e.cause }

func (a *App) providerFailure(snapshot executionSnapshot, err error) error {
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) { return err }
	var apiError *openai.Error
	if !errors.As(err, &apiError) {
		var dns *net.DNSError; if errors.As(err, &dns) { return &providerRequestError{cause: err, message: "供应商域名解析失败，请核对渠道地址和服务器 DNS；未自动重试生成"} }
		var network *net.OpError; if errors.As(err, &network) && network.Op == "dial" { return &providerRequestError{cause: err, message: "无法建立供应商连接，请核对服务器到渠道的网络；未自动重试生成"} }
		return err
	}
	message := providerError(err)
	redact, redactionErr := a.assistantRedactor(snapshot)
	if redactionErr == nil {
		detail := strings.Join(strings.Fields(apiError.Message), " ")
		if strings.Contains(detail, "data:") || strings.Contains(strings.ToLower(detail), "base64") || strings.Contains(detail, "b64_json") { detail = "" }
		if detail != "" { message += "："+text(redact(debugResponseMaterial(detail))) }
	}
	return &providerRequestError{cause: err, message: message}
}

func definitiveRejection(err error) bool {
	var preparation *scriptPreparationError; if errors.As(err, &preparation) { return true }
	var apiError *openai.Error
	return errors.As(err, &apiError) && includes([]string{"400", "401", "403", "404", "405", "413", "415", "422", "429"}, strconv.Itoa(apiError.StatusCode))
}

func (a *App) callText(ctx context.Context, turn AssistantTurn, snapshot executionSnapshot, messages []map[string]any, parameters map[string]any, references []assetInput, tools []map[string]any, onText func(string) error) (providerResult, error) {
    input := assistantInput(assistantSnapshot{Execution: snapshot, Messages: messages, Parameters: parameters, Media: references})
    task := GenerationTask{UserID: turn.UserID, Capability: "text"}
    arguments, err := a.scriptArguments(task, snapshot, input, true); if err != nil { return providerResult{}, &scriptPreparationError{cause: err} }; arguments["tools"] = tools
    return a.executeModelScript(ctx, task, "turn:"+turn.ID, snapshot, arguments, false, func(state map[string]any) error { if onText == nil { return nil }; return onText(text(state["text"])) })
}

func (a *App) persistProviderResponse(id string, body io.ReadCloser) (providerResult, error) {
	defer body.Close()
	directory := filepath.Join(a.root, "results")
	if err := os.MkdirAll(directory, 0700); err != nil { return providerResult{}, err }
	name := filepath.Join(directory, id+".json")
	file, err := os.OpenFile(name+".pending", os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0600)
	if err != nil { return providerResult{}, err }
	defer os.Remove(file.Name())
	_, err = io.Copy(file, body)
	if err == nil { err = file.Sync() }
	closeErr := file.Close()
	if err == nil { err = closeErr }
	if err == nil { err = os.Rename(file.Name(), name) }
	if err != nil { return providerResult{}, err }
	return providerResult{Status: "completed", ResponseFile: id+".json"}, nil
}


func scriptAuth(snapshot executionSnapshot) (string, string) {
    if snapshot.Script != nil { manifest, _, _, err := readScriptPackage(snapshot.Script.Files); if err == nil { if manifest.Auth.Type == "none" { return "", "" }; if manifest.Auth.Type == "header" { return manifest.Auth.Header, manifest.Auth.Prefix } } }
    return "Authorization", "Bearer "
}
