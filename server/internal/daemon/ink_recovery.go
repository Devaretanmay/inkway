package daemon

import (
	"context"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"
)

var inkRetryReasons = map[string]struct{}{
	"runtime_offline":              {},
	"runtime_recovery":             {},
	"timeout":                      {},
	"codex_semantic_inactivity":    {},
	"agent_error.provider_network": {},
	"skill_bundle_unavailable":     {},
}

func (d *Daemon) recordInkRetryOutcome(ctx context.Context, result TaskResult, failureReason string, completed bool, logger *slog.Logger) {
	if result.InkDecisionID == "" || result.InkIssueID == "" || result.InkRetryFailureReason == "" {
		return
	}
	if result.InkPriorSessionID == "" || result.SessionID == "" ||
		(result.InkDecisionChoice == "resume_session" && result.SessionID != result.InkPriorSessionID) ||
		(result.InkDecisionChoice == "fresh_session" && result.SessionID == result.InkPriorSessionID) {
		return // runtime did not prove the selected session mode was enacted.
	}
	quality := 0.0
	evidence := map[string]any{
		"retry_attempt":                  result.InkRetryAttempt,
		"same_terminal_failure_recurred": true,
		"failure_reason":                 result.InkRetryFailureReason,
	}
	if completed {
		statusCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		issue, err := d.client.GetIssueGCCheck(statusCtx, result.InkIssueID)
		cancel()
		if err != nil || issue == nil || !issue.ProgressedToReviewOrDone(result.InkIssueStatusBefore) {
			return // completion without verified delivery remains pending.
		}
		quality = 1
		evidence = map[string]any{
			"retry_attempt":                  result.InkRetryAttempt,
			"same_terminal_failure_recurred": false,
			"issue_status_before":            result.InkIssueStatusBefore,
			"issue_status_after":             issue.Status,
			"issue_category_after":           issue.Category,
		}
	} else if failureReason != result.InkRetryFailureReason {
		return // another/ambiguous failure does not verify this recovery choice.
	}
	recordCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := d.inkBridge.RecordOutcome(recordCtx, result.InkDecisionID, quality, "platform_retry_outcome", "1", evidence); err != nil {
		logger.Warn("Ink outcome remained unrecorded", "error", err)
	}
}

func (s IssueGCStatus) ProgressedToReviewOrDone(before string) bool {
	wasReviewOrDone := before == "in_review" || before == "done"
	if wasReviewOrDone {
		return false
	}
	return s.Status == "in_review" || s.Status == "done" || s.Category == "done"
}

func inkRecoveryEligible(enabled bool, task Task, provider string) bool {
	if !enabled || task.RetryOfTaskID == "" || task.PriorSessionID == "" || task.Attempt < 1 || task.Attempt > 100 {
		return false
	}
	if _, err := uuid.Parse(task.RetryOfTaskID); err != nil {
		return false
	}
	if _, ok := inkRetryReasons[task.RetryFailureReason]; !ok {
		return false
	}
	return len(provider) <= 40 && provider == strings.ToLower(provider)
}

// applyInkRecoveryAction only changes a retry already authorized by the
// server and only between the two runtime-supported recovery modes.
func applyInkRecoveryAction(task *Task, choice string) bool {
	if task == nil || task.RetryOfTaskID == "" || task.RetryFailureReason == "" || task.PriorSessionID == "" {
		return false
	}
	switch choice {
	case "resume_session":
		return true
	case "fresh_session":
		task.PriorSessionID = ""
		task.PriorSessionResumeUnavailable = true
		return true
	default:
		return false
	}
}
