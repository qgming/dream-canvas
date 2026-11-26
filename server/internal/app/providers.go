package app

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptrace"
	"net/netip"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
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

var blockedPrefixes = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"),
	netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("192.0.0.0/24"),
	netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("198.18.0.0/15"),
	netip.MustParsePrefix("198.51.100.0/24"),
	netip.MustParsePrefix("203.0.113.0/24"),
	netip.MustParsePrefix("240.0.0.0/4"),
	netip.MustParsePrefix("64:ff9b::/96"),
	netip.MustParsePrefix("64:ff9b:1::/48"),
	netip.MustParsePrefix("100::/64"),
	netip.MustParsePrefix("2001:db8::/32"),
}

func isBlockedIP(ip net.IP) bool {
	addr, ok := netip.AddrFromSlice(ip)
	if !ok { return true }
	addr = addr.Unmap()
	if !addr.IsGlobalUnicast() || addr.IsPrivate() || addr.IsLoopback() || addr.IsLinkLocalUnicast() || addr.IsLinkLocalMulticast() || addr.IsMulticast() || addr.IsUnspecified() { return true }
	for _, prefix := range blockedPrefixes {
		if prefix.Contains(addr) { return true }
	}
	return false
}

func externalTransport(policy executionPolicy) *http.Transport {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.TLSHandshakeTimeout = seconds(policy.ConnectSeconds)
	transport.MaxIdleConns = 32
	transport.MaxIdleConnsPerHost = 4
	transport.IdleConnTimeout = 60 * time.Second
	transport.ResponseHeaderTimeout = seconds(policy.FirstResponseSeconds)
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil { return nil, err }
		addresses, err := net.DefaultResolver.LookupIPAddr(ctx, host)
		if err != nil { return nil, err }
		if len(addresses) == 0 { return nil, errors.New("provider hostname has no public address") }
		for _, address := range addresses { if isBlockedIP(address.IP) { return nil, problem(400, "private_address", "供应商及素材地址必须指向公网 HTTPS 服务") } }
		var last error
		for _, address := range addresses { connection, err := (&net.Dialer{Timeout: seconds(policy.ConnectSeconds)}).DialContext(ctx, network, net.JoinHostPort(address.IP.String(), port)); if err == nil { return connection, nil }; last = err }
		return nil, last
	}
	return transport
}

type watchedBody struct { io.ReadCloser; mu sync.Mutex; timer *time.Timer; idle time.Duration; cancel context.CancelFunc; closed bool }
func (b *watchedBody) Read(data []byte) (int, error) {
	n, err := b.ReadCloser.Read(data)
	if n > 0 {
		b.mu.Lock()
		if !b.closed && b.timer != nil { b.timer.Reset(b.idle) }
		b.mu.Unlock()
	}
	return n, err
}
func (b *watchedBody) Close() error {
	b.mu.Lock()
	if !b.closed {
		b.closed = true
		if b.timer != nil { b.timer.Stop() }
		b.cancel()
	}
	b.mu.Unlock()
	return b.ReadCloser.Close()
}

type modelResponseBody struct { io.ReadCloser; ctx context.Context; cancel context.CancelCauseFunc; idle time.Duration }

func (b *modelResponseBody) Read(data []byte) (int, error) {
	if cause := context.Cause(b.ctx); cause != nil { return 0, cause }
	stop := armDeadline(b.idle, func() { b.cancel(&providerTimeoutError{stage: "provider_idle", cause: context.DeadlineExceeded}) })
	n, err := b.ReadCloser.Read(data)
	stop()
	if cause := context.Cause(b.ctx); cause != nil { return n, cause }
	return n, err
}

func (b *modelResponseBody) Close() error { b.cancel(nil); return b.ReadCloser.Close() }

type providerTransport struct { base http.RoundTripper; idle time.Duration; model bool }
func (t providerTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	ctx, cancel := context.WithCancelCause(request.Context())
	var written atomic.Bool
	if t.model { ctx = httptrace.WithClientTrace(ctx, &httptrace.ClientTrace{WroteRequest: func(info httptrace.WroteRequestInfo) { if info.Err == nil { written.Store(true) } }}) }
	response, err := t.base.RoundTrip(request.Clone(ctx))
	if err != nil {
		if t.model && isTimeout(err) && ctx.Err() == nil {
			stage := "provider_connection"; if written.Load() { stage = "provider_headers" }
			err = &providerTimeoutError{stage: stage, cause: err}
		}
		cancel(nil); return nil, err
	}
	if t.model {
		response.Body = &modelResponseBody{ReadCloser: response.Body, ctx: ctx, cancel: cancel, idle: t.idle}
	} else {
		close := func() { cancel(nil) }
		response.Body = &watchedBody{ReadCloser: response.Body, timer: time.AfterFunc(t.idle, close), idle: t.idle, cancel: close}
	}
	return response, nil
}

func providerHTTP(policy executionPolicy) *http.Client {
	return externalHTTP(policy, false)
}

func externalHTTP(policy executionPolicy, model bool) *http.Client {
	if model {
		policy.FirstResponseSeconds = policy.scriptLimit(modelHeaderSeconds, policy.FirstResponseSeconds)
		policy.IdleSeconds = policy.scriptLimit(modelIdleSeconds, policy.IdleSeconds)
	}
	return &http.Client{Transport: providerTransport{base: externalTransport(policy), idle: seconds(policy.IdleSeconds), model: model}, CheckRedirect: func(request *http.Request, via []*http.Request) error {
		if request.URL.Scheme != "https" || request.URL.User != nil { return errors.New("redirect must use HTTPS") }
		if len(via) > 0 && request.URL.Host != via[0].URL.Host { request.Header.Del("Authorization") }
		return http.ErrUseLastResponse
	}}
}

func (a *App) providerClient(snapshot executionSnapshot) (openai.Client, error) {
	credential, err := a.decryptSecret(snapshot.Credential)
	if err != nil { return openai.Client{}, err }
	header, prefix := scriptAuth(snapshot)
	opts := []option.RequestOption{option.WithAPIKey(""), option.WithHeaderDel("Authorization"), option.WithHeaderDel("OpenAI-Organization"), option.WithHeaderDel("OpenAI-Project"), option.WithBaseURL(strings.TrimRight(snapshot.BaseURL, "/")+"/"), option.WithMaxRetries(0), option.WithRequestTimeout(0), option.WithHTTPClient(externalHTTP(snapshot.Policy, true))}
	if header != "" { opts = append(opts, option.WithHeader(header, prefix+credential)) }
	return openai.NewClient(opts...), nil
}

func providerError(err error) string {
	var parse *scriptParseError; if errors.As(err, &parse) { return parse.Error() }
	var preparation *scriptPreparationError
	if errors.As(err, &preparation) {
		message := "接口请求映射或素材准备失败，请核对路径、参数与素材"
		var runtime *scriptRuntimeError; var rejected *Problem
		switch { case errors.As(err, &runtime): message = runtime.Error(); case isTimeout(err): message = "模型请求准备超时"; case errors.Is(err, context.Canceled): message = "模型请求准备已停止"; case errors.As(err, &rejected) && rejected.Code == "asset_encoding_limit": message = rejected.Message }
		if preparation.phase == "query" || preparation.phase == "followup" { return message+"；本次查询请求尚未发送" }
		return message+"；本次请求尚未提交供应商"
	}
	var request *providerRequestError; if errors.As(err, &request) { return request.Error() }
	var runtime *scriptRuntimeError; if errors.As(err, &runtime) { return runtime.Error()+"；本次请求已提交供应商，未自动重提" }
	var apiError *openai.Error
	if errors.As(err, &apiError) { return fmt.Sprintf("供应商返回 HTTP %d，请核对模型、参数、权限和供应商账单", apiError.StatusCode) }
	var timeout *providerTimeoutError; if errors.As(err, &timeout) { return timeout.Error()+"；未自动重提，请核对本次请求的结果与用量" }
	if errors.Is(err, context.Canceled) { return "调用已停止；请求可能已提交，结果与用量仍待确认" }
	if isTimeout(err) { return "本次模型调用达到时限，结果与用量待确认；未自动重提" }
	if errors.Is(err, io.ErrUnexpectedEOF) { return "供应商响应提前结束；结果与用量待确认，未自动重提" }
	return "供应商连接或响应读取失败，结果与用量待确认；未自动重提"
}

type providerTimeoutError struct { stage string; cause error }
func (e *providerTimeoutError) Error() string {
	switch e.stage {
	case "provider_headers": return "等待供应商响应头超时，请核对渠道或站点管理中的响应时限"
	case "provider_idle": return "等待读取供应商响应数据超时，请核对渠道或站点管理中的响应空闲时限"
	default: return "连接供应商超时，请核对渠道地址与服务器网络"
	}
}
func (e *providerTimeoutError) Unwrap() error { return e.cause }

func isTimeout(err error) bool {
	var timeout net.Error
	return errors.Is(err, context.DeadlineExceeded) || (errors.As(err, &timeout) && timeout.Timeout())
}

type providerRequestError struct { cause error; message string }
func (e *providerRequestError) Error() string { return e.message }
func (e *providerRequestError) Unwrap() error { return e.cause }

func (a *App) providerFailure(snapshot executionSnapshot, err error) error {
	if errors.Is(err, context.Canceled) || isTimeout(err) { return err }
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
	if beforeModelSubmission(err) { return true }
	var apiError *openai.Error
	return errors.As(err, &apiError) && includes([]string{"400", "401", "403", "404", "405", "413", "415", "422", "429"}, strconv.Itoa(apiError.StatusCode))
}

func (a *App) callText(ctx context.Context, turn AssistantTurn, snapshot executionSnapshot, messages []map[string]any, parameters map[string]any, references []assetInput, tools []map[string]any, onOutput func(string, string) error) (providerResult, error) {
    input := assistantInput(assistantSnapshot{Execution: snapshot, Messages: messages, Parameters: parameters, Media: references})
    task := GenerationTask{UserID: turn.UserID, Capability: "text"}
    arguments, err := a.scriptArguments(task, snapshot, input, true); if err != nil { return providerResult{}, &scriptPreparationError{cause: err, phase: "submit"} }; arguments["tools"] = tools
    return a.executeModelScript(ctx, task, "turn:"+turn.ID, snapshot, arguments, false, func(state map[string]any) error {
        content, _ := state["text"].(string)
        reasoning, _ := state["reasoning"].(string)
        return onOutput(content, reasoning)
    })
}

const maxProviderResponseBytes int64 = 64 << 20

func (a *App) persistProviderResponse(id string, body io.ReadCloser) (providerResult, error) {
	defer body.Close()
	directory := filepath.Join(a.root, "results")
	if err := os.MkdirAll(directory, 0700); err != nil { return providerResult{}, err }
	name := filepath.Join(directory, id+".json")
	file, err := os.OpenFile(name+".pending", os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0600)
	if err != nil { return providerResult{}, err }
	defer os.Remove(file.Name())
	written, err := io.Copy(file, io.LimitReader(body, maxProviderResponseBytes+1))
	if err == nil && written > maxProviderResponseBytes { err = problem(413, "provider_response_too_large", "供应商响应体积超过 64 MiB 限制") }
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
