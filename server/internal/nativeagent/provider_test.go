package nativeagent

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestOpenAICompatibleParsesToolCallsAndUsage(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/openai/v1/chat/completions" {
			t.Errorf("path=%s", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer test-key" {
			t.Error("missing bearer credential")
		}
		if r.Header.Get("Accept") != "application/json" || r.Header.Get("User-Agent") != "Inkway-NativeAgent/1.0" {
			t.Error("compatibility headers missing")
		}
		var req map[string]any
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatal(err)
		}
		if req["model"] != "gpt-test" {
			t.Errorf("model=%v", req["model"])
		}
		if _, ok := req["tools"]; !ok {
			t.Error("tools missing")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"finish_reason":"tool_calls","message":{"content":"","tool_calls":[{"id":"call-1","function":{"name":"read_file","arguments":"{\"path\":\"README.md\"}"}}]}}],"usage":{"prompt_tokens":12,"completion_tokens":3}}`))
	}))
	defer server.Close()
	p := &OpenAICompatible{BaseURL: server.URL + "/openai/v1", APIKey: "test-key", Model: "gpt-test", name: "openai"}
	resp, err := p.Generate(context.Background(), ModelRequest{Model: "fallback", Messages: []Message{{Role: "user", Content: "read"}}, Tools: []Tool{{Name: "read_file", Parameters: map[string]any{"type": "object"}}}})
	if err != nil {
		t.Fatal(err)
	}
	if len(resp.ToolCalls) != 1 || resp.ToolCalls[0].Name != "read_file" || string(resp.ToolCalls[0].Arguments) != `{"path":"README.md"}` {
		t.Fatalf("response=%+v", resp)
	}
	if resp.Usage.InputTokens != 12 || resp.Usage.OutputTokens != 3 || resp.Stop != "tool_calls" {
		t.Fatalf("metadata=%+v", resp)
	}
}

func TestProviderErrorsAreNormalized(t *testing.T) {
	for _, tc := range []struct {
		status int
		body   string
		kind   string
	}{
		{401, `{"error":{"message":"bad key"}}`, "authentication"},
		{429, `{"error":{"message":"slow down"}}`, "rate_limit"},
		{429, `{"error":{"message":"request limit reached","code":"insufficient_quota"}}`, "quota_exceeded"},
		{404, `{"error":{"message":"missing"}}`, "model_not_found"},
		{400, `{"error":{"message":"context window exceeded"}}`, "context_limit"},
		{500, `{"error":{"message":"oops"}}`, "server_error"},
	} {
		err := providerHTTPError("groq", tc.status, []byte(tc.body))
		var normalized *ProviderError
		if !errors.As(err, &normalized) || normalized.Kind != tc.kind {
			t.Errorf("status %d error=%v normalized=%+v", tc.status, err, normalized)
		}
	}
}

func TestAnthropicMapsToolUseAndToolResults(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/messages" || r.Header.Get("x-api-key") != "anthropic-test" || r.Header.Get("anthropic-version") == "" {
			t.Error("Anthropic request headers or path are invalid")
		}
		var req struct {
			System   string `json:"system"`
			Messages []struct {
				Role    string          `json:"role"`
				Content json.RawMessage `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatal(err)
		}
		if req.System != "system instructions" || len(req.Messages) != 3 {
			t.Fatalf("request=%+v", req)
		}
		var result []struct {
			Type string `json:"type"`
			ID   string `json:"tool_use_id"`
		}
		if err := json.Unmarshal(req.Messages[2].Content, &result); err != nil {
			t.Fatal(err)
		}
		if req.Messages[2].Role != "user" || len(result) != 1 || result[0].Type != "tool_result" || result[0].ID != "call-1" {
			t.Fatalf("tool result mapping=%+v %+v", req.Messages[2], result)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"content":[{"type":"text","text":"continuing"},{"type":"tool_use","id":"call-2","name":"write_file","input":{"path":"x.txt","content":"ok"}}],"stop_reason":"tool_use","usage":{"input_tokens":8,"output_tokens":5}}`))
	}))
	defer server.Close()
	p := NewAnthropic("anthropic-test", "claude-test")
	p.BaseURL = server.URL
	resp, err := p.Generate(context.Background(), ModelRequest{Model: "claude", System: "system instructions", Messages: []Message{{Role: "user", Content: "start"}, {Role: "assistant", Content: "reading", ToolCalls: []ToolCall{{ID: "call-1", Name: "read_file", Arguments: json.RawMessage(`{"path":"x"}`)}}}, {Role: "tool", ToolCallID: "call-1", Content: `{"content":"file data"}`}}, Tools: []Tool{{Name: "write_file", Parameters: map[string]any{"type": "object"}}}})
	if err != nil {
		t.Fatal(err)
	}
	if resp.Text != "continuing" || len(resp.ToolCalls) != 1 || resp.ToolCalls[0].Name != "write_file" || resp.Stop != "tool_use" {
		t.Fatalf("response=%+v", resp)
	}
	if resp.Usage.InputTokens != 8 || resp.Usage.OutputTokens != 5 {
		t.Fatalf("usage=%+v", resp.Usage)
	}
}

func TestProvidersBoundErrorsAndRejectMalformedToolArguments(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		status     int
		want       string
	}{{"auth", `{"error":{"message":"bad key"}}`, 401, "HTTP 401"}, {"malformed args", `{"choices":[{"message":{"tool_calls":[{"id":"x","function":{"name":"read_file","arguments":"not-json"}}]}}]}`, 200, "malformed tool arguments"}} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer server.Close()
			p := &OpenAICompatible{BaseURL: server.URL, APIKey: "secret", Model: "model", name: "openai"}
			_, err := p.Generate(context.Background(), ModelRequest{Model: "m", Messages: []Message{{Role: "user", Content: "x"}}})
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("err=%v want %q", err, tc.want)
			}
		})
	}
}

func TestProviderCredentialsAreNotForwardedAcrossRedirects(t *testing.T) {
	for _, tc := range []struct {
		name string
		make func(string) Provider
	}{
		{"openai", func(base string) Provider { return NewOpenAI(base, "redirect-secret", "model") }},
		{"anthropic", func(base string) Provider {
			provider := NewAnthropic("redirect-secret", "model")
			provider.BaseURL = base
			return provider
		}},
		{"groq", func(base string) Provider {
			return &OpenAICompatible{BaseURL: base, APIKey: "redirect-secret", Model: "model", name: "groq"}
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			redirected := false
			target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				redirected = true
				if r.Header.Get("Authorization") != "" || r.Header.Get("x-api-key") != "" {
					t.Error("provider credential forwarded to redirect target")
				}
			}))
			defer target.Close()
			source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				http.Redirect(w, r, target.URL, http.StatusFound)
			}))
			defer source.Close()

			provider := tc.make(source.URL)
			_, err := provider.Generate(context.Background(), ModelRequest{Model: "model", Messages: []Message{{Role: "user", Content: "hello"}}})
			if err == nil || redirected {
				t.Fatalf("redirect was followed: redirected=%t err=%v", redirected, err)
			}
		})
	}
}

func TestOpenAIUsesResponsesAPI(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/responses" {
			t.Errorf("path=%s", r.URL.Path)
		}
		var body struct {
			Instructions string            `json:"instructions"`
			Model        string            `json:"model"`
			Input        []json.RawMessage `json:"input"`
			Tools        []map[string]any  `json:"tools"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body.Instructions != "instructions" || body.Model != "gpt-native" || len(body.Input) != 1 || len(body.Tools) != 1 {
			t.Fatalf("request=%+v", body)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"completed","output":[{"type":"function_call","call_id":"call-1","name":"read_file","arguments":"{\"path\":\"README.md\"}"}],"usage":{"input_tokens":10,"output_tokens":2}}`))
	}))
	defer server.Close()
	p := NewOpenAI(server.URL+"/v1", "secret", "gpt-native")
	resp, err := p.Generate(context.Background(), ModelRequest{Model: "fallback", System: "instructions", Messages: []Message{{Role: "user", Content: "read"}}, Tools: []Tool{{Name: "read_file", Parameters: map[string]any{"type": "object"}}}})
	if err != nil {
		t.Fatal(err)
	}
	if len(resp.ToolCalls) != 1 || resp.ToolCalls[0].Name != "read_file" || resp.Usage.InputTokens != 10 {
		t.Fatalf("response=%+v", resp)
	}
}

func TestProviderAdaptersNormalizeTextOnlyResponsesAndRejectMalformedBodies(t *testing.T) {
	t.Run("OpenAI text and usage", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodPost || r.Header.Get("Authorization") != "Bearer openai-key" {
				t.Errorf("request method=%s authorization_present=%t", r.Method, r.Header.Get("Authorization") != "")
			}
			_, _ = w.Write([]byte(`{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"ready"}]}],"usage":{"input_tokens":4,"output_tokens":2}}`))
		}))
		defer server.Close()
		p := NewOpenAI(server.URL, "openai-key", "model")
		got, err := p.Generate(context.Background(), ModelRequest{Model: "model", Messages: []Message{{Role: "user", Content: "hello"}}})
		if err != nil || got.Text != "ready" || got.Usage.InputTokens != 4 || got.Usage.OutputTokens != 2 {
			t.Fatalf("response=%+v err=%v", got, err)
		}
	})
	for _, tc := range []struct {
		name     string
		provider Provider
	}{
		{name: "openai", provider: NewOpenAI("", "key", "model")},
		{name: "anthropic", provider: NewAnthropic("key", "model")},
	} {
		t.Run(tc.name+" malformed JSON", func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("{")) }))
			defer server.Close()
			switch p := tc.provider.(type) {
			case *OpenAICompatible:
				p.BaseURL = server.URL
			case *Anthropic:
				p.BaseURL = server.URL
			}
			_, err := tc.provider.Generate(context.Background(), ModelRequest{Model: "model", Messages: []Message{{Role: "user", Content: "hello"}}})
			if err == nil {
				t.Fatal("malformed response body accepted")
			}
		})
	}
}

func TestAnthropicErrorsAreNormalizedRedactedAndRetryBounded(t *testing.T) {
	for _, tc := range []struct {
		name, body, retry, want string
		status                  int
	}{
		{name: "authentication", status: http.StatusUnauthorized, body: `{"error":{"message":"invalid private-key"}}`, want: "authentication"},
		{name: "rate limit", status: http.StatusTooManyRequests, body: `{"error":{"message":"slow down"}}`, retry: "5", want: "rate_limit"},
		{name: "server error", status: http.StatusServiceUnavailable, body: `{"error":{"message":"try later"}}`, want: "server_error"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Retry-After", tc.retry)
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer server.Close()
			p := NewAnthropic("private-key", "claude")
			p.BaseURL = server.URL
			_, err := p.Generate(context.Background(), ModelRequest{Model: "claude", Messages: []Message{{Role: "user", Content: "hello"}}})
			var normalized *ProviderError
			if !errors.As(err, &normalized) || normalized.Kind != tc.want || strings.Contains(err.Error(), "private-key") {
				t.Fatalf("error=%v normalized=%+v", err, normalized)
			}
			if tc.retry != "" && normalized.RetryAfter != 5*time.Second {
				t.Fatalf("retry-after=%s", normalized.RetryAfter)
			}
		})
	}
}

func TestProviderErrorsRedactCredentialEcho(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(401)
		_, _ = w.Write([]byte(`{"error":{"message":"invalid secret-value"}}`))
	}))
	defer server.Close()
	p := &OpenAICompatible{BaseURL: server.URL, APIKey: "secret-value", Model: "m", name: "groq"}
	_, err := p.Generate(context.Background(), ModelRequest{Model: "m", Messages: []Message{{Role: "user", Content: "x"}}})
	if err == nil || strings.Contains(err.Error(), "secret-value") {
		t.Fatalf("credential leaked in error: %v", err)
	}
}

func TestProviderErrorCarriesBoundedRetryAfter(t *testing.T) {
	err := providerHTTPError("groq", http.StatusTooManyRequests, []byte(`{"error":{"message":"rate limited"}}`), "7")
	var providerErr *ProviderError
	if !errors.As(err, &providerErr) || providerErr.RetryAfter != 7*time.Second {
		t.Fatalf("error=%#v, retry-after = %v", err, providerErr)
	}
	err = providerHTTPError("groq", http.StatusTooManyRequests, []byte(`{}`), "999")
	if !errors.As(err, &providerErr) || providerErr.RetryAfter != 0 {
		t.Fatalf("unbounded retry-after accepted: %#v", providerErr)
	}
	err = providerHTTPError("groq", http.StatusTooManyRequests, []byte(`{"error":{"message":"rate limited"}}`))
	if !errors.As(err, &providerErr) || providerErr.RetryAfter != 0 {
		t.Fatalf("missing retry-after should be immediate: %#v", providerErr)
	}
}
