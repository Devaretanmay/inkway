package nativeagent

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type Anthropic struct {
	APIKey  string
	Model   string
	BaseURL string
	Client  *http.Client
}

func NewAnthropic(apiKey, model string) *Anthropic { return &Anthropic{APIKey: apiKey, Model: model} }
func (*Anthropic) Name() string                    { return "anthropic" }
func (p *Anthropic) Generate(ctx context.Context, req ModelRequest) (ModelResponse, error) {
	if err := validateRequest(req); err != nil {
		return ModelResponse{}, err
	}
	if strings.TrimSpace(p.APIKey) == "" {
		return ModelResponse{}, fmt.Errorf("anthropic API key is not configured")
	}
	model := strings.TrimSpace(p.Model)
	if model == "" {
		model = req.Model
	}
	messages := make([]map[string]any, 0, len(req.Messages))
	for _, m := range req.Messages {
		switch m.Role {
		case "user":
			messages = append(messages, map[string]any{"role": "user", "content": m.Content})
		case "assistant":
			blocks := make([]any, 0, 1+len(m.ToolCalls))
			if m.Content != "" {
				blocks = append(blocks, map[string]any{"type": "text", "text": m.Content})
			}
			for _, tc := range m.ToolCalls {
				var input any
				if err := json.Unmarshal(tc.Arguments, &input); err != nil {
					return ModelResponse{}, fmt.Errorf("invalid tool arguments: %w", err)
				}
				blocks = append(blocks, map[string]any{"type": "tool_use", "id": tc.ID, "name": tc.Name, "input": input})
			}
			messages = append(messages, map[string]any{"role": "assistant", "content": blocks})
		case "tool":
			var result any
			if err := json.Unmarshal([]byte(m.Content), &result); err != nil {
				result = m.Content
			}
			messages = append(messages, map[string]any{"role": "user", "content": []any{map[string]any{"type": "tool_result", "tool_use_id": m.ToolCallID, "content": result}}})
		}
	}
	body := map[string]any{"model": model, "max_tokens": 4096, "messages": messages}
	if strings.TrimSpace(req.System) != "" {
		body["system"] = req.System
	}
	if len(req.Tools) > 0 {
		tools := make([]any, 0, len(req.Tools))
		for _, t := range req.Tools {
			tools = append(tools, map[string]any{"name": t.Name, "description": t.Description, "input_schema": t.Parameters})
		}
		body["tools"] = tools
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return ModelResponse{}, err
	}
	base := strings.TrimRight(strings.TrimSpace(p.BaseURL), "/")
	if base == "" {
		base = "https://api.anthropic.com"
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/v1/messages", bytes.NewReader(payload))
	if err != nil {
		return ModelResponse{}, err
	}
	httpReq.Header.Set("x-api-key", p.APIKey)
	httpReq.Header.Set("anthropic-version", "2023-06-01")
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json")
	httpReq.Header.Set("User-Agent", "Inkway-NativeAgent/1.0")
	client := p.Client
	if client == nil {
		client = &http.Client{
			Timeout:       90 * time.Second,
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		}
	}
	resp, err := client.Do(httpReq)
	if err != nil {
		return ModelResponse{}, &ProviderError{Provider: "anthropic", Kind: "network", Message: "request failed"}
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return ModelResponse{}, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return ModelResponse{}, providerHTTPError("anthropic", resp.StatusCode, redactSecret(data, p.APIKey), resp.Header.Get("retry-after"))
	}
	var wire struct {
		Content []struct {
			Type  string          `json:"type"`
			Text  string          `json:"text"`
			ID    string          `json:"id"`
			Name  string          `json:"name"`
			Input json.RawMessage `json:"input"`
		} `json:"content"`
		Stop  string `json:"stop_reason"`
		Usage struct {
			Input  int64 `json:"input_tokens"`
			Output int64 `json:"output_tokens"`
		} `json:"usage"`
	}
	if err := json.Unmarshal(data, &wire); err != nil {
		return ModelResponse{}, fmt.Errorf("anthropic returned malformed response: %w", err)
	}
	out := ModelResponse{Stop: wire.Stop, Usage: Usage{InputTokens: wire.Usage.Input, OutputTokens: wire.Usage.Output}}
	for _, block := range wire.Content {
		if block.Type == "text" {
			out.Text += block.Text
		}
		if block.Type == "tool_use" {
			if !json.Valid(block.Input) {
				return ModelResponse{}, fmt.Errorf("anthropic returned malformed tool input")
			}
			out.ToolCalls = append(out.ToolCalls, ToolCall{ID: block.ID, Name: block.Name, Arguments: block.Input})
		}
	}
	return out, nil
}
