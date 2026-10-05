// Package nativeagent implements the small, platform-owned model/tool loop for
// native API agents. Provider credentials are supplied by the runtime process;
// callers must never persist them in central application storage.
package nativeagent

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

type ProviderError struct {
	Provider   string
	Kind       string
	Status     int
	Message    string
	RetryAfter time.Duration
}

func (e *ProviderError) Error() string {
	if e.Status > 0 {
		return fmt.Sprintf("%s provider %s (HTTP %d): %s", e.Provider, e.Kind, e.Status, e.Message)
	}
	return fmt.Sprintf("%s provider %s: %s", e.Provider, e.Kind, e.Message)
}

func normalizeProviderError(provider string, status int, message string) error {
	kind := "unknown"
	switch {
	case status == http.StatusTooManyRequests && (strings.Contains(strings.ToLower(message), "quota") || strings.Contains(strings.ToLower(message), "insufficient credit")):
		kind = "quota_exceeded"
	case status == http.StatusUnauthorized || status == http.StatusForbidden:
		kind = "authentication"
	case status == http.StatusTooManyRequests:
		kind = "rate_limit"
	case status == http.StatusNotFound:
		kind = "model_not_found"
	case status == http.StatusRequestTimeout || status == http.StatusGatewayTimeout:
		kind = "timeout"
	case status >= 500:
		kind = "server_error"
	case status >= 400 && (strings.Contains(strings.ToLower(message), "context") || strings.Contains(strings.ToLower(message), "token limit")):
		kind = "context_limit"
	case status >= 400:
		kind = "invalid_request"
	}
	return &ProviderError{Provider: provider, Kind: kind, Status: status, Message: message}
}

type ToolCall struct {
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Arguments json.RawMessage `json:"arguments"`
}

type Message struct {
	Role       string     `json:"role"`
	Content    string     `json:"content,omitempty"`
	ToolCallID string     `json:"tool_call_id,omitempty"`
	ToolCalls  []ToolCall `json:"tool_calls,omitempty"`
}

type Tool struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Parameters  any    `json:"parameters"`
}

type Usage struct {
	InputTokens  int64 `json:"input_tokens"`
	OutputTokens int64 `json:"output_tokens"`
}

type ModelRequest struct {
	Model    string
	System   string
	Messages []Message
	Tools    []Tool
}

type ModelResponse struct {
	Text      string
	ToolCalls []ToolCall
	Usage     Usage
	Stop      string
}

type Provider interface {
	Name() string
	Generate(context.Context, ModelRequest) (ModelResponse, error)
}

func validateRequest(req ModelRequest) error {
	if strings.TrimSpace(req.Model) == "" {
		return fmt.Errorf("native agent model is required")
	}
	if len(req.Messages) == 0 {
		return fmt.Errorf("native agent conversation is empty")
	}
	for i, m := range req.Messages {
		switch m.Role {
		case "user", "assistant", "tool":
		default:
			return fmt.Errorf("message %d has unsupported role %q", i, m.Role)
		}
	}
	return nil
}
