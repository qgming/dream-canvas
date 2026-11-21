package app

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestScriptRuntimeTimeoutStagesAndIsolation(t *testing.T) {
	var output bytes.Buffer
	a := &App{logs: &appLogger{logger: slog.New(slog.NewJSONHandler(&output, nil))}}
	a.logs.settings.Store(&LogSettings{Enabled: true})
	snapshot := executionSnapshot{Policy: suggestedPolicy()}
	snapshot.Policy.ScriptRuntime[scriptStreamSeconds] = 1
	ctx, cancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer cancel()
	_, err := a.runScript(ctx, snapshot, "submit", "return {};", nil)
	message := providerError(&scriptPreparationError{phase: "submit", cause: err})
	if !errors.Is(err, context.DeadlineExceeded) || !strings.Contains(message, "初始化超时") || !strings.Contains(message, "尚未提交供应商") {
		t.Fatalf("expected pre-submit initialization timeout, got %v: %s", err, message)
	}

	ctx = context.Background()
	run, close, err := a.scriptRunner(ctx, snapshot, "stream")
	if err != nil {
		t.Fatal(err)
	}
	defer close()
	if _, err := run(`globalThis.marker = input.marker; return {};`, map[string]string{"marker": "one-instance"}); err != nil {
		t.Fatal(err)
	}
	other, err := a.runScript(ctx, snapshot, "result", `return {marker: typeof globalThis.marker, encoded: encode("hex", "test")};`, nil)
	if err != nil || other["marker"] != "undefined" || other["encoded"] != "74657374" {
		t.Fatalf("instance state leaked or host binding failed: %v, %v", other, err)
	}
	// A pause between events must not spend either event's execution budget.
	time.Sleep(1050 * time.Millisecond)
	if value, err := run(`return {marker: globalThis.marker};`, nil); err != nil || value["marker"] != "one-instance" {
		t.Fatalf("the idle stream parser expired between events: %v, %v", value, err)
	}
	_, err = run(`while (true) {}`, map[string]string{"marker": "private-payload"})
	if !errors.Is(err, context.DeadlineExceeded) || !strings.Contains(providerError(err), "流式事件处理超时") || strings.Contains(providerError(err), "尚未提交") {
		t.Fatalf("expected stream execution timeout after submission, got %v", err)
	}
	if reply, err := a.runScript(ctx, snapshot, "result", `return {ready: true};`, nil); err != nil || reply["ready"] != true {
		t.Fatalf("timeout affected other instances: %v, %v", reply, err)
	}
	for _, field := range []string{`"kind":"script_init_timeout"`, `"kind":"script_execution_timeout"`, `"timed_out_stage":"sandbox_init"`, `"timed_out_stage":"script_eval"`, `"sandbox_init_ms":`, `"input_bytes":`} {
		if !strings.Contains(output.String(), field) {
			t.Errorf("missing %s in technical logs: %s", field, output.String())
		}
	}
	if strings.Contains(output.String(), "private-payload") {
		t.Fatal("script input was logged")
	}
	if strings.Contains(providerError(&scriptParseError{phase: "结果", cause: err}), "原响应已保存") {
		t.Fatal("assistant parse failure claimed a saved provider response")
	}
}

func TestModelTransportSeparatesHeaderAndReadTimeouts(t *testing.T) {
	resume := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/stream" {
			_, _ = io.WriteString(w, "first")
			w.(http.Flusher).Flush()
			select {
			case <-resume:
			case <-r.Context().Done():
				return
			}
			_, _ = io.WriteString(w, "next")
			w.(http.Flusher).Flush()
		}
		<-r.Context().Done()
	}))
	defer server.Close()
	base := &http.Transport{ResponseHeaderTimeout: 250 * time.Millisecond}
	defer base.CloseIdleConnections()
	idle := 250 * time.Millisecond
	client := &http.Client{Transport: providerTransport{base: base, idle: idle, model: true}, Timeout: 5 * time.Second}
	response, err := client.Get(server.URL + "/headers")
	if response != nil {
		response.Body.Close()
	}
	var timeout *providerTimeoutError
	if !errors.As(err, &timeout) || timeout.stage != "provider_headers" {
		t.Fatalf("expected response header timeout: %v", err)
	}

	response, err = client.Get(server.URL + "/stream")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if _, err := io.ReadFull(response.Body, make([]byte, len("first"))); err != nil {
		t.Fatal(err)
	}
	time.Sleep(2 * idle) // The caller is processing the event, not waiting on the network.
	close(resume)
	if _, err := io.ReadFull(response.Body, make([]byte, len("next"))); err != nil {
		t.Fatalf("idle timer ran while not reading: %v", err)
	}
	_, err = io.ReadAll(response.Body)
	if !errors.As(err, &timeout) || timeout.stage != "provider_idle" || !isTimeout(err) {
		t.Fatalf("expected response read timeout: %v", err)
	}
}
