package nativeagent

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// OpenAICompatible supports OpenAI and Groq's documented chat-completions
// subset. It intentionally sends only standard tool definitions and messages.
type OpenAICompatible struct {
	BaseURL         string
	APIKey          string
	Model           string
	Client          *http.Client
	name            string
	UseResponses    bool
	MaxOutputTokens int
}

func NewOpenAI(baseURL, apiKey, model string) *OpenAICompatible {
	return &OpenAICompatible{BaseURL: baseURL, APIKey: apiKey, Model: model, name: "openai", UseResponses: true}
}
func NewGroq(apiKey, model string) *OpenAICompatible {
	return &OpenAICompatible{BaseURL: "https://api.groq.com/openai/v1", APIKey: apiKey, Model: model, name: "groq"}
}
func (p *OpenAICompatible) Name() string { return p.name }

func (p *OpenAICompatible) Generate(ctx context.Context, req ModelRequest) (ModelResponse, error) {
	if err := validateRequest(req); err != nil {
		return ModelResponse{}, err
	}
	if strings.TrimSpace(p.APIKey) == "" {
		return ModelResponse{}, fmt.Errorf("%s API key is not configured", p.Name())
	}
	if p.UseResponses {
		return p.generateResponses(ctx, req)
	}
	base := strings.TrimRight(strings.TrimSpace(p.BaseURL), "/")
	if base == "" {
		base = "https://api.openai.com/v1"
	}
	model := strings.TrimSpace(p.Model)
	if model == "" {
		model = req.Model
	}
	type wireMessage struct {
		Role       string `json:"role"`
		Content    string `json:"content,omitempty"`
		ToolCallID string `json:"tool_call_id,omitempty"`
		ToolCalls  []struct {
			ID       string `json:"id"`
			Type     string `json:"type"`
			Function struct {
				Name      string `json:"name"`
				Arguments string `json:"arguments"`
			} `json:"function"`
		} `json:"tool_calls,omitempty"`
	}
	messages := make([]wireMessage, 0, len(req.Messages)+1)
	if strings.TrimSpace(req.System) != "" {
		messages = append(messages, wireMessage{Role: "system", Content: req.System})
	}
	for _, m := range req.Messages {
		wm := wireMessage{Role: m.Role, Content: m.Content, ToolCallID: m.ToolCallID}
		for _, tc := range m.ToolCalls {
			wm.ToolCalls = append(wm.ToolCalls, struct {
				ID       string `json:"id"`
				Type     string `json:"type"`
				Function struct {
					Name      string `json:"name"`
					Arguments string `json:"arguments"`
				} `json:"function"`
			}{ID: tc.ID, Type: "function", Function: struct {
				Name      string `json:"name"`
				Arguments string `json:"arguments"`
			}{Name: tc.Name, Arguments: string(tc.Arguments)}})
		}
		messages = append(messages, wm)
	}
	body := map[string]any{"model": model, "messages": messages}
	if p.MaxOutputTokens > 0 {
		body["max_tokens"] = p.MaxOutputTokens
	}
	if len(req.Tools) > 0 {
		tools := make([]any, 0, len(req.Tools))
		for _, t := range req.Tools {
			tools = append(tools, map[string]any{"type": "function", "function": map[string]any{"name": t.Name, "description": t.Description, "parameters": t.Parameters}})
		}
		body["tools"] = tools
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return ModelResponse{}, err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/chat/completions", bytes.NewReader(payload))
	if err != nil {
		return ModelResponse{}, err
	}
	httpReq.Header.Set("Authorization", "Bearer "+p.APIKey)
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json")
	httpReq.Header.Set("User-Agent", "Inkway-NativeAgent/1.0")
	client := p.Client
	if client == nil {
		client = &http.Client{Timeout: 90 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	}
	resp, err := client.Do(httpReq)
	if err != nil {
		return ModelResponse{}, &ProviderError{Provider: p.Name(), Kind: "network", Message: "request failed"}
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return ModelResponse{}, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return ModelResponse{}, providerHTTPError(p.Name(), resp.StatusCode, redactSecret(data, p.APIKey), resp.Header.Get("Retry-After"))
	}
	var wire struct {
		Choices []struct {
			FinishReason string `json:"finish_reason"`
			Message      struct {
				Content   string `json:"content"`
				ToolCalls []struct {
					ID       string `json:"id"`
					Function struct {
						Name      string `json:"name"`
						Arguments string `json:"arguments"`
					} `json:"function"`
				} `json:"tool_calls"`
			} `json:"message"`
		} `json:"choices"`
		Usage struct {
			PromptTokens     int64 `json:"prompt_tokens"`
			CompletionTokens int64 `json:"completion_tokens"`
		} `json:"usage"`
	}
	if err := json.Unmarshal(data, &wire); err != nil {
		return ModelResponse{}, fmt.Errorf("%s returned malformed response: %w", p.Name(), err)
	}
	if len(wire.Choices) == 0 {
		return ModelResponse{}, fmt.Errorf("%s returned no choices", p.Name())
	}
	choice := wire.Choices[0]
	out := ModelResponse{Text: choice.Message.Content, Stop: choice.FinishReason, Usage: Usage{InputTokens: wire.Usage.PromptTokens, OutputTokens: wire.Usage.CompletionTokens}}
	for _, tc := range choice.Message.ToolCalls {
		args := json.RawMessage(tc.Function.Arguments)
		if !json.Valid(args) {
			return ModelResponse{}, fmt.Errorf("%s returned malformed tool arguments", p.Name())
		}
		out.ToolCalls = append(out.ToolCalls, ToolCall{ID: tc.ID, Name: tc.Function.Name, Arguments: args})
	}
	return out, nil
}

func providerHTTPError(provider string, status int, body []byte, retryAfterValues ...string) error {
	var payload struct {
		Error struct {
			Message string `json:"message"`
			Type    string `json:"type"`
			Code    string `json:"code"`
		} `json:"error"`
	}
	_ = json.Unmarshal(body, &payload)
	message := strings.TrimSpace(payload.Error.Message)
	if message == "" {
		message = "provider rejected the request"
	}
	if len(message) > 500 {
		message = message[:500]
	}
	err := normalizeProviderError(provider, status, message)
	if status == http.StatusTooManyRequests && strings.Contains(strings.ToLower(payload.Error.Code), "quota") {
		var providerErr *ProviderError
		if errors.As(err, &providerErr) {
			providerErr.Kind = "quota_exceeded"
		}
	}
	if len(retryAfterValues) > 0 && retryAfterValues[0] != "" {
		if wait, parseErr := strconv.Atoi(strings.TrimSpace(retryAfterValues[0])); parseErr == nil && wait >= 0 && wait <= 60 {
			var providerErr *ProviderError
			if errors.As(err, &providerErr) {
				providerErr.RetryAfter = time.Duration(wait) * time.Second
			}
		}
	}
	return err
}

func (p *OpenAICompatible) generateResponses(ctx context.Context, req ModelRequest) (ModelResponse, error) {
	base := strings.TrimRight(strings.TrimSpace(p.BaseURL), "/")
	if base == "" {
		base = "https://api.openai.com/v1"
	}
	model := strings.TrimSpace(p.Model)
	if model == "" {
		model = req.Model
	}
	input := make([]any, 0, len(req.Messages))
	for _, m := range req.Messages {
		switch m.Role {
		case "user":
			input = append(input, map[string]any{"role": "user", "content": []any{map[string]any{"type": "input_text", "text": m.Content}}})
		case "assistant":
			if strings.TrimSpace(m.Content) != "" {
				input = append(input, map[string]any{"role": "assistant", "content": []any{map[string]any{"type": "output_text", "text": m.Content}}})
			}
			for _, tc := range m.ToolCalls {
				input = append(input, map[string]any{"type": "function_call", "call_id": tc.ID, "name": tc.Name, "arguments": string(tc.Arguments)})
			}
		case "tool":
			input = append(input, map[string]any{"type": "function_call_output", "call_id": m.ToolCallID, "output": m.Content})
		}
	}
	body := map[string]any{"model": model, "input": input}
	if p.MaxOutputTokens > 0 {
		body["max_output_tokens"] = p.MaxOutputTokens
	}
	if strings.TrimSpace(req.System) != "" {
		body["instructions"] = req.System
	}
	if len(req.Tools) > 0 {
		tools := make([]any, 0, len(req.Tools))
		for _, t := range req.Tools {
			tools = append(tools, map[string]any{"type": "function", "name": t.Name, "description": t.Description, "parameters": t.Parameters, "strict": false})
		}
		body["tools"] = tools
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return ModelResponse{}, err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/responses", bytes.NewReader(payload))
	if err != nil {
		return ModelResponse{}, err
	}
	httpReq.Header.Set("Authorization", "Bearer "+p.APIKey)
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json")
	httpReq.Header.Set("User-Agent", "Inkway-NativeAgent/1.0")
	client := p.Client
	if client == nil {
		client = &http.Client{Timeout: 90 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	}
	resp, err := client.Do(httpReq)
	if err != nil {
		return ModelResponse{}, &ProviderError{Provider: p.Name(), Kind: "network", Message: "request failed"}
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return ModelResponse{}, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return ModelResponse{}, providerHTTPError(p.Name(), resp.StatusCode, redactSecret(data, p.APIKey), resp.Header.Get("Retry-After"))
	}
	var wire struct {
		Output []struct {
			Type      string `json:"type"`
			Text      string `json:"text"`
			CallID    string `json:"call_id"`
			Name      string `json:"name"`
			Arguments string `json:"arguments"`
			Content   []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"content"`
		} `json:"output"`
		Status string `json:"status"`
		Usage  struct {
			Input  int64 `json:"input_tokens"`
			Output int64 `json:"output_tokens"`
		} `json:"usage"`
	}
	if err := json.Unmarshal(data, &wire); err != nil {
		return ModelResponse{}, fmt.Errorf("%s returned malformed response: %w", p.Name(), err)
	}
	out := ModelResponse{Stop: wire.Status, Usage: Usage{InputTokens: wire.Usage.Input, OutputTokens: wire.Usage.Output}}
	for _, item := range wire.Output {
		switch item.Type {
		case "message", "output_text":
			out.Text += item.Text
			for _, block := range item.Content {
				if block.Type == "output_text" || block.Type == "text" {
					out.Text += block.Text
				}
			}
		case "function_call":
			args := json.RawMessage(item.Arguments)
			if !json.Valid(args) {
				return ModelResponse{}, fmt.Errorf("%s returned malformed tool arguments", p.Name())
			}
			out.ToolCalls = append(out.ToolCalls, ToolCall{ID: item.CallID, Name: item.Name, Arguments: args})
		}
	}
	if len(wire.Output) == 0 {
		return ModelResponse{}, fmt.Errorf("%s returned no output items", p.Name())
	}
	return out, nil
}

func redactSecret(body []byte, secret string) []byte {
	if secret == "" {
		return body
	}
	return []byte(strings.ReplaceAll(string(body), secret, "[redacted]"))
}
