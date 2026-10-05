package daemon

import "testing"

func TestInkRecoveryGatesToEligibleAutomaticRetry(t *testing.T) {
	base := Task{RetryOfTaskID: "11111111-1111-4111-8111-111111111111", RetryFailureReason: "timeout", Attempt: 1, PriorSessionID: "session"}
	if !inkRecoveryEligible(true, base, "codex") {
		t.Fatal("server-authorized resumable retry should reach the decision boundary")
	}
	for name, tc := range map[string]struct {
		enabled  bool
		task     Task
		provider string
	}{
		"disabled":             {false, base, "codex"},
		"not automatic retry":  {true, Task{RetryFailureReason: "timeout", Attempt: 1, PriorSessionID: "session"}, "codex"},
		"no safe session":      {true, Task{RetryOfTaskID: base.RetryOfTaskID, RetryFailureReason: "timeout", Attempt: 1}, "codex"},
		"nonretryable failure": {true, Task{RetryOfTaskID: base.RetryOfTaskID, RetryFailureReason: "provider_auth_or_access", Attempt: 1, PriorSessionID: "session"}, "codex"},
		"invalid provider":     {true, base, "bad Provider"},
	} {
		t.Run(name, func(t *testing.T) {
			if inkRecoveryEligible(tc.enabled, tc.task, tc.provider) {
				t.Fatal("unexpectedly eligible")
			}
		})
	}
}

func TestInkRecoveryRoutesOnlyExistingSessionModes(t *testing.T) {
	task := Task{RetryOfTaskID: "11111111-1111-4111-8111-111111111111", RetryFailureReason: "timeout", PriorSessionID: "session"}
	if !applyInkRecoveryAction(&task, "resume_session") || task.PriorSessionID != "session" {
		t.Fatalf("resume action changed session: %+v", task)
	}
	if !applyInkRecoveryAction(&task, "fresh_session") || task.PriorSessionID != "" || !task.PriorSessionResumeUnavailable {
		t.Fatalf("fresh action did not clear resume: %+v", task)
	}
	if applyInkRecoveryAction(&task, "switch_provider") {
		t.Fatal("accepted unsupported action")
	}
}
