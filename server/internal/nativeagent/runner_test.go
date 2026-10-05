package nativeagent

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

type scriptedProvider struct {
	calls  int
	script []struct {
		response ModelResponse
		err      error
	}
}

func (p *scriptedProvider) Name() string { return "openai" }
func (p *scriptedProvider) Generate(_ context.Context, _ ModelRequest) (ModelResponse, error) {
	i := p.calls
	p.calls++
	if i >= len(p.script) {
		return ModelResponse{}, errors.New("script exhausted")
	}
	return p.script[i].response, p.script[i].err
}

type recoveryRecorder struct {
	calls          int
	site           string
	state          RecoveryState
	fallback, task string
}

func (r *recoveryRecorder) Decide(_ context.Context, site string, state RecoveryState, fallback, task string) (string, string, string, error) {
	r.calls++
	r.site = site
	r.state = state
	r.fallback = fallback
	r.task = task
	return "fresh_session", "fast_path", "decision-1", nil
}

func TestRunnerRoutesProviderFailureThroughExistingRecoverySite(t *testing.T) {
	root := t.TempDir()
	if out, err := exec.Command("git", "init", root).CombinedOutput(); err != nil {
		t.Fatalf("git init: %s %v", out, err)
	}
	p := &scriptedProvider{script: []struct {
		response ModelResponse
		err      error
	}{{err: errors.New("request timeout")}, {response: ModelResponse{Text: "done", Usage: Usage{InputTokens: 2, OutputTokens: 1}}}}}
	decider := &recoveryRecorder{}
	r := Runner{Provider: p, Model: "m", Root: root, Recovery: decider, TaskID: "task-1"}
	result, err := r.Run(context.Background(), "implement")
	if err != nil {
		t.Fatal(err)
	}
	if p.calls != 2 || decider.calls != 1 || decider.site != RecoverySite || decider.fallback != "fresh_session" || decider.task != "task-1" {
		t.Fatalf("calls=%d decision=%+v", p.calls, decider)
	}
	if decider.state.Provider != "openai" || decider.state.FailureReason != "timeout" || decider.state.RetryAttempt != 1 {
		t.Fatalf("state=%+v", decider.state)
	}
	if result.RecoveryDecisions != 1 || result.RecoverySources["fast_path"] != 1 || result.CloudCalls != 2 || result.Usage.InputTokens != 2 {
		t.Fatalf("result=%+v", result)
	}
}

type cancelingRecovery struct{ cancel context.CancelFunc }

func (r cancelingRecovery) Decide(context.Context, string, RecoveryState, string, string) (string, string, string, error) {
	r.cancel()
	return "resume_session", "fallback", "decision-cancel", nil
}

func TestRunnerCancellationStopsRetryAfterWait(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	p := &scriptedProvider{script: []struct {
		response ModelResponse
		err      error
	}{{err: &ProviderError{Provider: "groq", Kind: "rate_limit", RetryAfter: 30 * time.Second}}}}
	result, err := (&Runner{Provider: p, Root: t.TempDir(), Recovery: cancelingRecovery{cancel}, TaskID: "cancel-wait"}).Run(ctx, "task")
	if !errors.Is(err, context.Canceled) || p.calls != 1 || result.RecoveryDecisions != 1 {
		t.Fatalf("result=%+v calls=%d err=%v", result, p.calls, err)
	}
}

func TestNativeToolsRejectTraversalSymlinksAndShellExecution(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "secret"), []byte("secret"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "escape")); err != nil {
		t.Fatal(err)
	}
	exec, err := newToolExecutor(root)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name string
		args string
	}{{"traversal", `{"path":"../secret"}`}, {"symlink", `{"path":"escape/secret"}`}} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := exec.execute(context.Background(), "read_file", json.RawMessage(tc.args))
			if err == nil {
				t.Fatal("expected path rejection")
			}
		})
	}
	if _, err := exec.execute(context.Background(), "write_file", json.RawMessage(`{"path":"escape/secret","content":"overwritten"}`)); err == nil {
		t.Fatal("symlink write escape must be rejected")
	}
	if got, err := os.ReadFile(filepath.Join(outside, "secret")); err != nil || string(got) != "secret" {
		t.Fatalf("outside target changed: content=%q err=%v", got, err)
	}
	_, err = exec.execute(context.Background(), "run_command", json.RawMessage(`{"argv":["sh","-c","cat ../secret"]}`))
	if err == nil {
		t.Fatal("shell command must be rejected")
	}
}

func TestNativeCommandOutputIsBoundedAndProviderEnvironmentIsNotInherited(t *testing.T) {
	if _, err := exec.LookPath("python3"); err != nil {
		t.Skip("python3 unavailable for controlled subprocess test")
	}
	t.Setenv("OPENAI_API_KEY", "do-not-inherit-openai")
	t.Setenv("GROQ_API_KEY", "do-not-inherit-groq")
	executor, err := newToolExecutor(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	got, err := executor.execute(context.Background(), "run_command", json.RawMessage(`{"argv":["python3","-c","import os;print(os.getenv('OPENAI_API_KEY','missing'));print(os.getenv('GROQ_API_KEY','missing'))"]}`))
	if err != nil || got != "missing\nmissing\n" {
		t.Fatalf("environment output=%q err=%v", got, err)
	}
	got, err = executor.execute(context.Background(), "run_command", json.RawMessage(`{"argv":["python3","-c","print('x'*50000)"]}`))
	if err != nil || !strings.HasSuffix(got, "[output truncated]") || len(got) > maxToolOutputBytes+32 {
		t.Fatalf("bounded output bytes=%d err=%v tail=%q", len(got), err, got[max(0, len(got)-24):])
	}
}

func TestNativeCommandTimeoutTerminatesSubprocess(t *testing.T) {
	if _, err := exec.LookPath("python3"); err != nil {
		t.Skip("python3 unavailable for controlled subprocess test")
	}
	executor, err := newToolExecutor(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 350*time.Millisecond)
	defer cancel()
	output, err := executor.execute(ctx, "run_command", json.RawMessage(`{"argv":["python3","-u","-c","import os,time;print(os.getpid(),flush=True);time.sleep(30)"]}`))
	if err == nil || !errors.Is(ctx.Err(), context.DeadlineExceeded) {
		t.Fatalf("timeout result=%q err=%v context=%v", output, err, ctx.Err())
	}
	pid, err := strconv.Atoi(strings.TrimSpace(output))
	if err != nil || pid <= 0 {
		t.Fatalf("subprocess pid output=%q err=%v", output, err)
	}
	process, err := os.FindProcess(pid)
	if err != nil {
		t.Fatal(err)
	}
	if err := process.Signal(syscall.Signal(0)); err == nil {
		t.Fatalf("timed-out subprocess %d remains alive", pid)
	}
}

func TestNativeCommandCancellationTerminatesSubprocess(t *testing.T) {
	if _, err := exec.LookPath("python3"); err != nil {
		t.Skip("python3 unavailable for controlled subprocess test")
	}
	executor, err := newToolExecutor(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	timer := time.AfterFunc(300*time.Millisecond, cancel)
	defer timer.Stop()
	defer cancel()
	output, err := executor.execute(ctx, "run_command", json.RawMessage(`{"argv":["python3","-u","-c","import os,time;print(os.getpid(),flush=True);time.sleep(30)"]}`))
	if err == nil || !errors.Is(ctx.Err(), context.Canceled) {
		t.Fatalf("cancel result=%q err=%v", output, err)
	}
	pid, err := strconv.Atoi(strings.TrimSpace(output))
	if err != nil || pid <= 0 {
		t.Fatalf("subprocess pid output=%q err=%v", output, err)
	}
	process, err := os.FindProcess(pid)
	if err != nil {
		t.Fatal(err)
	}
	if err := process.Signal(syscall.Signal(0)); err == nil {
		t.Fatalf("cancelled subprocess %d remains alive", pid)
	}
}

func TestNativeToolsWriteReadAndCollectDiff(t *testing.T) {
	root := t.TempDir()
	exec, err := newToolExecutor(root)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := exec.execute(context.Background(), "write_file", json.RawMessage(`{"path":"nested/proof.txt","content":"verified"}`)); err != nil {
		t.Fatal(err)
	}
	got, err := exec.execute(context.Background(), "read_file", json.RawMessage(`{"path":"nested/proof.txt"}`))
	if err != nil || got != "verified" {
		t.Fatalf("read=%q err=%v", got, err)
	}
}

func TestNativeToolsSearchPatchAndSensitivePathGuard(t *testing.T) {
	root := t.TempDir()
	exec, err := newToolExecutor(root)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "code.txt"), []byte("before\nneedle\nafter\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".env"), []byte("needle=secret-value"), 0600); err != nil {
		t.Fatal(err)
	}
	search, err := exec.execute(context.Background(), "search_text", json.RawMessage(`{"query":"needle"}`))
	if err != nil || !strings.Contains(search, "code.txt:2:needle") || strings.Contains(search, "secret-value") {
		t.Fatalf("search=%q err=%v", search, err)
	}
	if _, err := exec.execute(context.Background(), "read_file", json.RawMessage(`{"path":".env"}`)); err == nil {
		t.Fatal("sensitive file was readable")
	}
	if _, err := exec.execute(context.Background(), "write_file", json.RawMessage(`{"path":".env","content":"overwritten"}`)); err == nil {
		t.Fatal("sensitive file was writable")
	}
	if _, err := exec.execute(context.Background(), "apply_patch", json.RawMessage(`{"path":"code.txt","old":"needle","new":"verified"}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := exec.execute(context.Background(), "apply_patch", json.RawMessage(`{"path":"code.txt","old":"absent","new":"x"}`)); err == nil {
		t.Fatal("missing replacement should not silently pass")
	}
	got, err := os.ReadFile(filepath.Join(root, "code.txt"))
	if err != nil || !strings.Contains(string(got), "verified") {
		t.Fatalf("patched=%q err=%v", got, err)
	}
}

func TestNativeRunnerStopsOnCredentialFailureWithoutRecovery(t *testing.T) {
	p := &scriptedProvider{script: []struct {
		response ModelResponse
		err      error
	}{{err: errors.New("openai returned HTTP 401: invalid credential")}}}
	decider := &recoveryRecorder{}
	_, err := (&Runner{Provider: p, Root: t.TempDir(), Recovery: decider}).Run(context.Background(), "task")
	if err == nil || decider.calls != 0 {
		t.Fatalf("err=%v recovery_calls=%d", err, decider.calls)
	}
}

func TestNativeRunnerDoesNotRetryExhaustedProviderQuota(t *testing.T) {
	p := &scriptedProvider{script: []struct {
		response ModelResponse
		err      error
	}{{err: &ProviderError{Provider: "groq", Kind: "quota_exceeded", Status: 429, Message: "quota exhausted"}}}}
	decider := &recoveryRecorder{}
	_, err := (&Runner{Provider: p, Root: t.TempDir(), Recovery: decider}).Run(context.Background(), "task")
	if err == nil || p.calls != 1 || decider.calls != 0 {
		t.Fatalf("calls=%d recovery_calls=%d err=%v", p.calls, decider.calls, err)
	}
}

func TestRunnerEnforcesTotalToolCallLimit(t *testing.T) {
	root := t.TempDir()
	p := &scriptedProvider{script: []struct {
		response ModelResponse
		err      error
	}{{response: ModelResponse{ToolCalls: []ToolCall{
		{ID: "1", Name: "write_file", Arguments: json.RawMessage(`{"path":"a.txt","content":"a"}`)},
		{ID: "2", Name: "write_file", Arguments: json.RawMessage(`{"path":"b.txt","content":"b"}`)},
		{ID: "3", Name: "write_file", Arguments: json.RawMessage(`{"path":"c.txt","content":"c"}`)},
	}}}}}
	_, err := (&Runner{Provider: p, Root: root, MaxToolCalls: 2, MaxToolCallsPerTurn: 8}).Run(context.Background(), "task")
	if err == nil || !strings.Contains(err.Error(), "2-tool-call limit") {
		t.Fatalf("expected total call limit, got %v", err)
	}
	for _, name := range []string{"a.txt", "b.txt"} {
		if _, err := os.Stat(filepath.Join(root, name)); err != nil {
			t.Fatalf("first tool calls did not execute: %v", err)
		}
	}
	if _, err := os.Stat(filepath.Join(root, "c.txt")); !os.IsNotExist(err) {
		t.Fatalf("third tool call executed: %v", err)
	}
}

func TestRunnerRejectsConversationOverContextBudgetBeforeProviderCall(t *testing.T) {
	p := &scriptedProvider{}
	r := Runner{Provider: p, Model: "m", Root: t.TempDir(), MaxInputBytes: 256}
	_, err := r.Run(context.Background(), strings.Repeat("context", 100))
	if err == nil || !strings.Contains(err.Error(), "conversation exceeds") {
		t.Fatalf("err=%v, want context budget failure", err)
	}
	if p.calls != 0 {
		t.Fatalf("provider called %d times for over-budget request", p.calls)
	}
}

func TestControlledLocalNativeRunEditsAndTestsRepository(t *testing.T) {
	root := t.TempDir()
	for name, body := range map[string]string{
		"go.mod":        "module phase4proof\n\ngo 1.23\n",
		"calculator.go": "package phase4proof\n\nfunc Add(a, b int) int { return a + b }\n",
	} {
		if err := os.WriteFile(filepath.Join(root, name), []byte(body), 0644); err != nil {
			t.Fatal(err)
		}
	}
	if out, err := exec.Command("git", "init", root).CombinedOutput(); err != nil {
		t.Fatalf("git init: %s %v", out, err)
	}
	for _, args := range [][]string{{"-C", root, "config", "user.email", "phase4-proof@example.invalid"}, {"-C", root, "config", "user.name", "Phase 4 Proof"}, {"-C", root, "add", "go.mod", "calculator.go"}, {"-C", root, "commit", "-m", "baseline"}} {
		if out, err := exec.Command("git", args...).CombinedOutput(); err != nil {
			t.Fatalf("git %v: %s %v", args, out, err)
		}
	}
	writeArgs, err := json.Marshal(map[string]string{
		"path":    "calculator_test.go",
		"content": "package phase4proof\n\nimport \"testing\"\n\nfunc TestAdd(t *testing.T) { if got := Add(2, 3); got != 5 { t.Fatalf(\"Add(2,3) = %d, want 5\", got) } }\n",
	})
	if err != nil {
		t.Fatal(err)
	}
	p := &scriptedProvider{script: []struct {
		response ModelResponse
		err      error
	}{
		{response: ModelResponse{ToolCalls: []ToolCall{{ID: "write", Name: "write_file", Arguments: writeArgs}}}},
		{response: ModelResponse{ToolCalls: []ToolCall{{ID: "test", Name: "run_command", Arguments: json.RawMessage(`{"argv":["go","test","./..."]}`)}}}},
		{response: ModelResponse{Text: "Added a focused test for Add; go test ./... passed."}},
	}}
	result, err := (&Runner{Provider: p, Model: "deterministic-local", Root: root, TaskID: "phase4-controlled-local"}).Run(context.Background(), "Add a focused test for Add and run it.")
	if err != nil {
		t.Fatal(err)
	}
	if p.calls != 3 || result.TestsRun != 1 || result.TestsPassed != 1 || result.TestsFailed != 0 {
		t.Fatalf("provider_calls=%d result=%+v", p.calls, result)
	}
	if len(result.FilesChanged) != 1 || result.FilesChanged[0] != "calculator_test.go" {
		t.Fatalf("files changed = %v", result.FilesChanged)
	}
	content, err := os.ReadFile(filepath.Join(root, "calculator_test.go"))
	if err != nil || !strings.Contains(string(content), "func TestAdd") {
		t.Fatalf("test file content = %q err=%v", content, err)
	}
}

func TestRunnerStopsRepeatedIdenticalToolCalls(t *testing.T) {
	call := ToolCall{ID: "same", Name: "write_file", Arguments: json.RawMessage(`{"path":"same.txt","content":"x"}`)}
	p := &scriptedProvider{script: []struct {
		response ModelResponse
		err      error
	}{{response: ModelResponse{ToolCalls: []ToolCall{call}}}, {response: ModelResponse{ToolCalls: []ToolCall{call}}}, {response: ModelResponse{ToolCalls: []ToolCall{call}}}, {response: ModelResponse{ToolCalls: []ToolCall{call}}}}}
	_, err := (&Runner{Provider: p, Root: t.TempDir()}).Run(context.Background(), "task")
	if err == nil || !strings.Contains(err.Error(), "repeated identical write_file") {
		t.Fatalf("expected repeated-call stop, got %v", err)
	}
}

func TestCommandEnvironmentKeepsProviderSecretOutAndScopesTaskToken(t *testing.T) {
	t.Setenv("OPENAI_API_KEY", "do-not-inherit")
	t.Setenv("PATH", "/usr/bin")
	cli := strings.Join(safeCommandEnv("inkway", map[string]string{"INKWAY_TOKEN": "task-scoped", "INKWAY_SERVER_URL": "https://example.test"}), "\n")
	if strings.Contains(cli, "do-not-inherit") || !strings.Contains(cli, "INKWAY_TOKEN=task-scoped") || !strings.Contains(cli, "INKWAY_SERVER_URL=https://example.test") {
		t.Fatalf("scoped cli env=%q", cli)
	}
	build := strings.Join(safeCommandEnv("go", map[string]string{"INKWAY_TOKEN": "task-scoped"}), "\n")
	if strings.Contains(build, "INKWAY_TOKEN") || strings.Contains(build, "OPENAI_API_KEY") {
		t.Fatalf("build command inherited secret=%q", build)
	}
}

func TestTestCommandClassifierUsesCommandShape(t *testing.T) {
	for _, tc := range []struct {
		argv []string
		want bool
	}{{[]string{"go", "test", "./..."}, true}, {[]string{"pnpm", "run", "test"}, true}, {[]string{"pytest", "tests"}, true}, {[]string{"git", "status"}, false}, {[]string{"go", "run", "./cmd/test-fixture"}, false}, {[]string{"make", "check"}, false}} {
		if got := isTestCommand(tc.argv); got != tc.want {
			t.Errorf("isTestCommand(%v)=%v want %v", tc.argv, got, tc.want)
		}
	}
}
