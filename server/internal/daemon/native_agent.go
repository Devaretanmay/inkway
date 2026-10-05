package daemon

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/Devaretanmay/inkway/server/internal/ink"
	"github.com/Devaretanmay/inkway/server/internal/nativeagent"
)

type nativeAgentConfig struct {
	ExecutionType string `json:"execution_type"`
	Provider      string `json:"provider"`
	Model         string `json:"model"`
	BaseURL       string `json:"base_url,omitempty"`
}

func decodeNativeAgentConfig(raw json.RawMessage) (nativeAgentConfig, bool, error) {
	if len(raw) == 0 {
		return nativeAgentConfig{}, false, nil
	}
	var cfg nativeAgentConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return cfg, false, fmt.Errorf("decode agent runtime_config: %w", err)
	}
	cfg.ExecutionType = strings.ToLower(strings.TrimSpace(cfg.ExecutionType))
	if cfg.ExecutionType != "native" {
		return cfg, false, nil
	}
	cfg.Provider = strings.ToLower(strings.TrimSpace(cfg.Provider))
	if cfg.Provider != "openai" && cfg.Provider != "anthropic" && cfg.Provider != "groq" {
		return cfg, true, fmt.Errorf("native agent provider must be openai, anthropic, or groq")
	}
	return cfg, true, nil
}

type daemonNativeRecovery struct {
	daemon *Daemon
	bridge *ink.Bridge
	taskID string
}

func (r daemonNativeRecovery) Decide(ctx context.Context, site string, state nativeagent.RecoveryState, fallback, taskID string) (string, string, string, error) {
	if r.bridge == nil || site != nativeagent.RecoverySite {
		return "", "", "", fmt.Errorf("native recovery site unavailable")
	}
	decisionCtx, cancel := context.WithTimeout(ctx, 13*time.Second)
	defer cancel()
	d, err := r.bridge.Decide(decisionCtx, ink.State{Provider: state.Provider, FailureReason: state.FailureReason, RetryAttempt: state.RetryAttempt, PreviousSessionExists: state.PreviousSessionExists}, fallback, r.taskID)
	if err != nil {
		return "", "", "", err
	}
	if r.daemon != nil {
		r.daemon.invalidateInkSnapshot()
	}
	if d.DecisionID == nil || *d.DecisionID == "" {
		return d.Choice, d.Source, "", nil
	}
	return d.Choice, d.Source, *d.DecisionID, nil
}

func (d *Daemon) executeNativeAgent(ctx context.Context, task Task, provider nativeagent.Provider, source string, model, prompt, system, workdir string, taskEnv map[string]string, logger *slog.Logger) (nativeagent.Result, error) {
	recovery := nativeagent.RecoveryDecider(nil)
	if ink.Enabled() {
		recovery = daemonNativeRecovery{daemon: d, bridge: d.inkBridge, taskID: task.ID}
	}
	runner := nativeagent.Runner{Provider: provider, Model: model, Root: workdir, System: system, Recovery: recovery, TaskID: task.ID, MaxRuntime: d.cfg.AgentTimeout, TaskCLIEnv: map[string]string{"INKWAY_SERVER_URL": taskEnv["INKWAY_SERVER_URL"], "INKWAY_WORKSPACE_ID": task.WorkspaceID, "INKWAY_TOKEN": taskEnv["INKWAY_TOKEN"]}, OnEvent: func(e nativeagent.RunEvent) {
		switch e.Kind {
		case "provider_request_started":
			logger.Info("native provider request started", "provider", e.Provider, "model", e.Model, "credential_source", source)
		case "provider_request_completed":
			logger.Info("native provider request completed", "provider", e.Provider, "model", e.Model)
		case "provider_request_failed":
			logger.Warn("native provider request failed", "provider", e.Provider, "model", e.Model)
		case "tool_started":
			logger.Info("native tool started", "tool", e.Tool)
		case "tool_completed":
			logger.Info("native tool completed", "tool", e.Tool, "status", e.Status)
		case "ink_decision":
			logger.Info("native Ink decision", "site", nativeagent.RecoverySite, "choice", e.Status)
		}
	}}
	return runner.Run(ctx, prompt)
}

func (d *Daemon) recordNativeRecoveryOutcome(ctx context.Context, result TaskResult, logger *slog.Logger) {
	if result.NativeRecoveryDecisionID == "" || result.NativeRecoverySessionBefore == "" || result.NativeRecoverySessionAfter == "" {
		return
	}
	if (result.NativeRecoveryChoice == "resume_session" && result.NativeRecoverySessionBefore != result.NativeRecoverySessionAfter) || (result.NativeRecoveryChoice == "fresh_session" && result.NativeRecoverySessionBefore == result.NativeRecoverySessionAfter) {
		return
	}
	statusCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	issue, err := d.client.GetIssueGCCheck(statusCtx, result.NativeRecoveryIssueID)
	cancel()
	if err != nil || issue == nil || !issue.ProgressedToReviewOrDone(result.NativeRecoveryIssueStatusBefore) {
		return
	}
	evidence := map[string]any{"execution_type": "native", "provider": result.NativeRecoveryProvider, "failure_reason": result.NativeRecoveryFailureReason, "retry_attempt": result.NativeRecoveryAttempt, "choice": result.NativeRecoveryChoice, "source": result.NativeRecoverySource, "session_mode_enacted": true, "issue_status_before": result.NativeRecoveryIssueStatusBefore, "issue_status_after": issue.Status, "issue_category_after": issue.Category}
	recordCtx, recordCancel := context.WithTimeout(ctx, 5*time.Second)
	defer recordCancel()
	if err := d.inkBridge.RecordOutcome(recordCtx, result.NativeRecoveryDecisionID, 1, "platform_native_recovery_outcome", "1", evidence); err != nil {
		logger.Warn("native Ink outcome remained unrecorded", "error", err)
	}
}

func nativeTaskResult(task Task, cfg nativeAgentConfig, result nativeagent.Result, workdir string) TaskResult {
	out := TaskResult{WorkDir: workdir, Usage: []TaskUsageEntry{{Provider: cfg.Provider, Model: cfg.Model, InputTokens: result.Usage.InputTokens, OutputTokens: result.Usage.OutputTokens}}, NativeRecoveryDecisionID: result.LastDecisionID, NativeRecoveryChoice: result.LastDecisionChoice, NativeRecoverySource: result.LastDecisionSource, NativeRecoveryProvider: cfg.Provider, NativeRecoveryFailureReason: result.LastFailureReason, NativeRecoveryAttempt: result.LastRecoveryAttempt, NativeRecoveryIssueID: task.IssueID, NativeRecoveryIssueStatusBefore: task.IssueStatus, NativeRecoverySessionBefore: result.RecoverySessionBefore, NativeRecoverySessionAfter: result.RecoverySessionAfter}
	return out
}

func nativeCompletionComment(result nativeagent.Result) string {
	var b strings.Builder
	b.WriteString(result.Summary)
	b.WriteString(nativeRunAccountingComment(result))
	if len(result.FilesChanged) > 0 {
		b.WriteString(" Changed files:")
		for _, file := range result.FilesChanged {
			b.WriteString(" ")
			b.WriteString(file)
		}
	} else {
		b.WriteString(" No working-tree changes detected.")
	}
	return b.String()
}

func nativeRunAccountingComment(result nativeagent.Result) string {
	var b strings.Builder
	fmt.Fprintf(&b, "\n\nRun accounting: %d provider requests; %d input / %d output tokens; %d Ink recovery decisions", result.CloudCalls, result.Usage.InputTokens, result.Usage.OutputTokens, result.RecoveryDecisions)
	for _, source := range []string{"fast_path", "fallback"} {
		if count := result.RecoverySources[source]; count > 0 {
			fmt.Fprintf(&b, "; %s %d", source, count)
		}
	}
	fmt.Fprintf(&b, ". Tests: %d run, %d passed, %d failed; failed commands %d.", result.TestsRun, result.TestsPassed, result.TestsFailed, result.CommandsFailed)
	return b.String()
}
