package nativeagent

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"time"
)

const RecoverySite = "coding_agent.recovery_action"

type RecoveryState struct {
	Provider              string `json:"provider"`
	FailureReason         string `json:"failure_reason"`
	RetryAttempt          int    `json:"retry_attempt"`
	PreviousSessionExists bool   `json:"previous_session_exists"`
}
type RecoveryDecider interface {
	Decide(context.Context, string, RecoveryState, string, string) (choice, source, decisionID string, err error)
}
type RunEvent struct {
	Kind     string `json:"kind"`
	Tool     string `json:"tool,omitempty"`
	Status   string `json:"status,omitempty"`
	Provider string `json:"provider,omitempty"`
	Model    string `json:"model,omitempty"`
}
type Result struct {
	Summary               string         `json:"summary"`
	FilesChanged          []string       `json:"files_changed"`
	TestsRun              int            `json:"tests_run"`
	TestsPassed           int            `json:"tests_passed"`
	TestsFailed           int            `json:"tests_failed"`
	CommandsFailed        int            `json:"commands_failed"`
	CompletionReason      string         `json:"completion_reason"`
	Usage                 Usage          `json:"usage"`
	CloudCalls            int            `json:"cloud_calls"`
	RecoveryDecisions     int            `json:"recovery_decisions"`
	LastDecisionID        string         `json:"-"`
	LastDecisionChoice    string         `json:"-"`
	LastDecisionSource    string         `json:"-"`
	LastFailureReason     string         `json:"-"`
	LastRecoveryAttempt   int            `json:"-"`
	RecoverySessionBefore string         `json:"-"`
	RecoverySessionAfter  string         `json:"-"`
	RecoverySources       map[string]int `json:"recovery_sources"`
}
type Runner struct {
	Provider            Provider
	Model               string
	Root                string
	System              string
	MaxTurns            int
	MaxToolCallsPerTurn int
	MaxToolCalls        int
	MaxRuntime          time.Duration
	// MaxInputBytes bounds serialized conversation context before sending it to
	// providers with strict per-minute token limits. A failed oversized request
	// otherwise burns repeated provider quota during retries.
	MaxInputBytes int
	Recovery      RecoveryDecider
	TaskID        string
	OnEvent       func(RunEvent)
	TaskCLIEnv    map[string]string
}

func (r *Runner) emit(e RunEvent) {
	if r.OnEvent != nil {
		r.OnEvent(e)
	}
}
func (r *Runner) Run(ctx context.Context, prompt string) (Result, error) {
	if r.Provider == nil {
		return Result{}, fmt.Errorf("native provider is required")
	}
	exec, err := newToolExecutor(r.Root)
	if err != nil {
		return Result{}, err
	}
	exec.taskCLIEnv = r.TaskCLIEnv
	maxRuntime := r.MaxRuntime
	if maxRuntime <= 0 || maxRuntime > 2*time.Hour {
		maxRuntime = 30 * time.Minute
	}
	ctx, cancel := context.WithTimeout(ctx, maxRuntime)
	defer cancel()
	maxTurns := r.MaxTurns
	if maxTurns <= 0 || maxTurns > 32 {
		maxTurns = 16
	}
	maxCalls := r.MaxToolCallsPerTurn
	if maxCalls <= 0 || maxCalls > 8 {
		maxCalls = 4
	}
	initial := Message{Role: "user", Content: prompt}
	messages := []Message{initial}
	result := Result{FilesChanged: []string{}, RecoverySources: map[string]int{}}
	retries := 0
	maxTotalCalls := r.MaxToolCalls
	if maxTotalCalls <= 0 || maxTotalCalls > 512 {
		maxTotalCalls = 128
	}
	totalCalls := 0
	maxInputBytes := r.MaxInputBytes
	if maxInputBytes <= 0 || maxInputBytes > 256<<10 {
		maxInputBytes = 48 << 10
	}
	repeatedCalls := map[[32]byte]int{}
	sessionID := "native-session-" + r.TaskID + "-1"
	for turn := 0; turn < maxTurns; turn++ {
		if requestSize := conversationSize(r.Model, r.System, messages, ToolDefinitions()); requestSize > maxInputBytes {
			return result, fmt.Errorf("native agent conversation exceeds %d-byte context budget (%d bytes)", maxInputBytes, requestSize)
		}
		r.emit(RunEvent{Kind: "provider_request_started", Provider: r.Provider.Name(), Model: r.Model})
		result.CloudCalls++
		resp, err := r.Provider.Generate(ctx, ModelRequest{Model: r.Model, System: r.System, Messages: messages, Tools: ToolDefinitions()})
		if err != nil {
			r.emit(RunEvent{Kind: "provider_request_failed", Provider: r.Provider.Name(), Model: r.Model})
			if ctx.Err() != nil {
				return result, ctx.Err()
			}
			if r.Recovery == nil || retries >= 2 {
				return result, err
			}
			failureReason := classifyProviderFailure(err)
			if !retryableProviderFailure(failureReason) {
				return result, err
			}
			choice, source, decisionID, recoveryErr := r.Recovery.Decide(ctx, RecoverySite, RecoveryState{Provider: r.Provider.Name(), FailureReason: failureReason, RetryAttempt: retries + 1, PreviousSessionExists: len(messages) > 1}, "fresh_session", r.TaskID)
			if recoveryErr != nil {
				return result, fmt.Errorf("provider failed (%v); Ink recovery failed: %w", err, recoveryErr)
			}
			result.RecoveryDecisions++
			result.LastDecisionID = decisionID
			result.LastDecisionChoice = choice
			result.LastDecisionSource = source
			result.LastFailureReason = failureReason
			result.LastRecoveryAttempt = retries + 1
			result.RecoverySessionBefore = sessionID
			result.RecoverySessionAfter = sessionID
			result.RecoverySources[source]++
			r.emit(RunEvent{Kind: "ink_decision", Provider: r.Provider.Name(), Status: choice + ":" + source})
			switch choice {
			case "resume_session":
			case "fresh_session":
				sessionID = "native-session-" + r.TaskID + "-" + fmt.Sprint(retries+2)
				result.RecoverySessionAfter = sessionID
				messages = []Message{initial}
			default:
				return result, fmt.Errorf("Ink returned unsupported recovery action %q", choice)
			}
			retries++
			var providerErr *ProviderError
			if errors.As(err, &providerErr) && providerErr.RetryAfter > 0 {
				timer := time.NewTimer(providerErr.RetryAfter)
				select {
				case <-ctx.Done():
					timer.Stop()
					return result, ctx.Err()
				case <-timer.C:
				}
			}
			turn--
			continue
		}
		result.Usage.InputTokens += resp.Usage.InputTokens
		result.Usage.OutputTokens += resp.Usage.OutputTokens
		r.emit(RunEvent{Kind: "provider_request_completed", Provider: r.Provider.Name(), Model: r.Model})
		if len(resp.ToolCalls) == 0 {
			result.Summary = strings.TrimSpace(resp.Text)
			result.CompletionReason = "model_completed"
			if result.Summary == "" {
				return result, fmt.Errorf("model completed without a summary")
			}
			return r.finish(ctx, exec, result)
		}
		assistant := Message{Role: "assistant", Content: resp.Text, ToolCalls: resp.ToolCalls}
		messages = append(messages, assistant)
		if len(resp.ToolCalls) > maxCalls {
			return result, fmt.Errorf("model requested %d tools in one turn; limit is %d", len(resp.ToolCalls), maxCalls)
		}
		for _, call := range resp.ToolCalls {
			totalCalls++
			if totalCalls > maxTotalCalls {
				return result, fmt.Errorf("native agent reached the %d-tool-call limit", maxTotalCalls)
			}
			callKey := sha256.Sum256(append(append([]byte(call.Name+"\x00"), call.Arguments...), 0))
			repeatedCalls[callKey]++
			if repeatedCalls[callKey] > 3 {
				return result, fmt.Errorf("native agent repeated identical %s call more than 3 times", call.Name)
			}
			r.emit(RunEvent{Kind: "tool_started", Tool: call.Name})
			output, toolErr := exec.execute(ctx, call.Name, call.Arguments)
			toolStatus := "completed"
			if toolErr != nil {
				toolStatus = "failed"
				if call.Name == "run_command" {
					result.CommandsFailed++
				}
				output = fmt.Sprintf("error: %s\n%s", toolErr, output)
			}
			if call.Name == "run_command" {
				var cmdArgs struct {
					Argv []string `json:"argv"`
				}
				_ = json.Unmarshal(call.Arguments, &cmdArgs)
				if isTestCommand(cmdArgs.Argv) {
					result.TestsRun++
					if toolErr == nil {
						result.TestsPassed++
					} else {
						result.TestsFailed++
					}
				}
			}
			r.emit(RunEvent{Kind: "tool_completed", Tool: call.Name, Status: toolStatus})
			messages = append(messages, Message{Role: "tool", ToolCallID: call.ID, Content: mustJSON(map[string]string{"output": output, "status": toolStatus})})
		}
	}
	return result, fmt.Errorf("native agent reached the %d-turn limit", maxTurns)
}

func conversationSize(model, system string, messages []Message, tools []Tool) int {
	b, err := json.Marshal(struct {
		Model    string    `json:"model"`
		System   string    `json:"system"`
		Messages []Message `json:"messages"`
		Tools    []Tool    `json:"tools"`
	}{model, system, messages, tools})
	if err != nil {
		return int(^uint(0) >> 1)
	}
	return len(b)
}

func (r *Runner) finish(ctx context.Context, e *toolExecutor, result Result) (Result, error) {
	r.emit(RunEvent{Kind: "tool_started", Tool: "git_diff"})
	if _, err := e.execute(ctx, "git_diff", json.RawMessage(`{}`)); err != nil {
		r.emit(RunEvent{Kind: "tool_completed", Tool: "git_diff", Status: "failed"})
		return result, fmt.Errorf("inspect final working-tree diff: %w", err)
	}
	r.emit(RunEvent{Kind: "tool_completed", Tool: "git_diff", Status: "completed"})
	r.emit(RunEvent{Kind: "tool_started", Tool: "run_command"})
	out, err := e.execute(ctx, "run_command", json.RawMessage(mustJSON(map[string]any{"argv": []string{"git", "status", "--short"}})))
	if err != nil {
		r.emit(RunEvent{Kind: "tool_completed", Tool: "run_command", Status: "failed"})
		return result, fmt.Errorf("inspect final working-tree status: %w", err)
	}
	r.emit(RunEvent{Kind: "tool_completed", Tool: "run_command", Status: "completed"})
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimRight(line, "\r")
		if len(line) > 3 {
			result.FilesChanged = append(result.FilesChanged, strings.TrimSpace(line[3:]))
		}
	}
	return result, nil
}
func mustJSON(v any) string { b, _ := json.Marshal(v); return string(b) }
func classifyProviderFailure(err error) string {
	var providerErr *ProviderError
	if errors.As(err, &providerErr) {
		return providerErr.Kind
	}
	s := strings.ToLower(err.Error())
	switch {
	case strings.Contains(s, "401"), strings.Contains(s, "403"), strings.Contains(s, "api key"):
		return "provider_auth_or_access"
	case strings.Contains(s, "429"), strings.Contains(s, "rate limit"):
		return "provider_rate_limit"
	case strings.Contains(s, "400"), strings.Contains(s, "404"), strings.Contains(s, "422"), strings.Contains(s, "model not found"):
		return "provider_configuration"
	case strings.Contains(s, "timeout"), strings.Contains(s, "deadline exceeded"):
		return "timeout"
	case strings.Contains(s, "context length"), strings.Contains(s, "context window"):
		return "provider_context_limit"
	default:
		return "provider_network"
	}
}
func retryableProviderFailure(reason string) bool {
	return reason == "timeout" || reason == "network" || reason == "rate_limit" || reason == "server_error" || reason == "provider_network" || reason == "provider_rate_limit"
}
func isTestCommand(argv []string) bool {
	if len(argv) == 0 {
		return false
	}
	bin := filepath.Base(argv[0])
	args := argv[1:]
	switch bin {
	case "go", "cargo", "npm", "pnpm", "make":
		if len(args) == 0 {
			return false
		}
		return args[0] == "test" || (len(args) > 1 && args[0] == "run" && args[1] == "test")
	case "pytest":
		return true
	case "python", "python3":
		return len(args) >= 2 && args[0] == "-m" && args[1] == "pytest"
	default:
		return false
	}
}
