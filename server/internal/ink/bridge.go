package ink

import (
	"bufio"
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

//go:embed bridge.py db_migration.py
var source embed.FS

const requestTimeout = 12 * time.Second
const restartDelay = 5 * time.Second
const startupTimeout = 90 * time.Second

type Decision struct {
	Choice             string  `json:"choice"`
	Source             string  `json:"source"`
	DecisionID         *string `json:"decision_id"`
	SiteVersion        string  `json:"site_version"`
	FastPathVersion    *string `json:"fast_path_version"`
	FallbackReason     *string `json:"fallback_reason"`
	HostFallbackReason *string `json:"host_fallback_reason"`
}

type State struct {
	Provider              string `json:"provider"`
	FailureReason         string `json:"failure_reason"`
	RetryAttempt          int    `json:"retry_attempt"`
	PreviousSessionExists bool   `json:"previous_session_exists"`
}

type Request struct {
	Op              string   `json:"op"`
	State           State    `json:"state,omitempty"`
	SafeChoice      string   `json:"safe_choice,omitempty"`
	CorrelationID   string   `json:"correlation_id,omitempty"`
	DecisionID      string   `json:"decision_id,omitempty"`
	Quality         *float64 `json:"quality,omitempty"`
	Verifier        string   `json:"verifier,omitempty"`
	VerifierVersion string   `json:"verifier_version,omitempty"`
	Evidence        any      `json:"evidence,omitempty"`
}

type Response struct {
	ID              string `json:"id"`
	OK              bool   `json:"ok"`
	Error           string `json:"error,omitempty"`
	Version         string `json:"version,omitempty"`
	ProtocolVersion int    `json:"protocol_version,omitempty"`
	ModelName       string `json:"model_name,omitempty"`
	ModelVersion    string `json:"model_version,omitempty"`
	ModelSHA256     string `json:"model_sha256,omitempty"`
	ModelVerified   bool   `json:"model_verified,omitempty"`
	ModelError      string `json:"model_error,omitempty"`
	Decision
	Health      json.RawMessage `json:"health,omitempty"`
	Maintenance json.RawMessage `json:"maintenance,omitempty"`
	Recorded    bool            `json:"recorded,omitempty"`
}

type Snapshot struct {
	Status string       `json:"status"`
	Sites  []SiteHealth `json:"sites"`
}

type SiteHealth struct {
	Name              string     `json:"name"`
	Version           string     `json:"version"`
	Status            string     `json:"status"`
	Observations      int64      `json:"observations"`
	VerifiedOutcomes  int64      `json:"verified_outcomes"`
	FastServed        int64      `json:"fast_served"`
	Coverage          float64    `json:"coverage"`
	FalseServes       int64      `json:"false_serves"`
	LastMaintenance   *time.Time `json:"last_maintenance,omitempty"`
	ModelCallsAvoided *int64     `json:"model_calls_avoided,omitempty"`
	SavingsBasis      string     `json:"savings_basis,omitempty"`
}

type lineResult struct {
	line []byte
	err  error
}

type Bridge struct {
	mu          sync.Mutex
	logger      *slog.Logger
	cmd         *exec.Cmd
	stdin       io.WriteCloser
	lines       chan lineResult
	scannerStop chan struct{}
	lastStart   time.Time
	seq         atomic.Uint64
}

func Enabled() bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv("INK_ENABLED")))
	return v == "true" || v == "1" || v == "yes"
}

func New(logger *slog.Logger) *Bridge {
	if logger == nil {
		logger = slog.Default()
	}
	return &Bridge{logger: logger}
}

func (b *Bridge) Available() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.cmd != nil && b.cmd.Process != nil
}

func (b *Bridge) Start(ctx context.Context) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.ensureStartedLocked(ctx)
}

func (b *Bridge) Decide(ctx context.Context, state State, safeChoice, correlationID string) (Decision, error) {
	var out Response
	err := b.call(ctx, Request{Op: "decide", State: state, SafeChoice: safeChoice, CorrelationID: correlationID}, &out)
	if err != nil {
		return Decision{}, err
	}
	if !out.OK {
		return Decision{}, errors.New(out.Error)
	}
	if out.Choice != "resume_session" && out.Choice != "fresh_session" {
		return Decision{}, errors.New("bridge returned undeclared recovery action")
	}
	return out.Decision, nil
}

func (b *Bridge) RecordOutcome(ctx context.Context, id string, quality float64, verifier, version string, evidence any) error {
	var out Response
	if err := b.call(ctx, Request{Op: "record_outcome", DecisionID: id, Quality: &quality, Verifier: verifier, VerifierVersion: version, Evidence: evidence}, &out); err != nil {
		return err
	}
	if !out.OK {
		return errors.New(out.Error)
	}
	return nil
}

func (b *Bridge) FleetHealth(ctx context.Context) (json.RawMessage, error) {
	var out Response
	if err := b.call(ctx, Request{Op: "fleet_health"}, &out); err != nil {
		return nil, err
	}
	if !out.OK {
		return nil, errors.New(out.Error)
	}
	return out.Health, nil
}

func (b *Bridge) Snapshot(ctx context.Context) (Snapshot, error) {
	raw, err := b.FleetHealth(ctx)
	if err != nil {
		return Snapshot{}, err
	}
	var payload struct {
		Sites map[string]json.RawMessage `json:"sites"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return Snapshot{}, err
	}
	out := Snapshot{Status: "connected"}
	for name, rawSite := range payload.Sites {
		var site struct {
			Name             string   `json:"name"`
			Version          string   `json:"version"`
			Status           string   `json:"status"`
			Observations     int64    `json:"observations"`
			VerifiedOutcomes int64    `json:"verified_outcomes"`
			FastServed       int64    `json:"fast_served"`
			Coverage         float64  `json:"coverage"`
			FalseServes      int64    `json:"false_serves"`
			LastMaintenance  *float64 `json:"last_maintenance"`
			Savings          struct {
				ModelCallsAvoided *int64 `json:"model_calls_avoided"`
				Basis             string `json:"savings_basis"`
			} `json:"savings"`
		}
		if err := json.Unmarshal(rawSite, &site); err != nil {
			return Snapshot{}, err
		}
		if site.Name == "" {
			site.Name = name
		}
		if site.LastMaintenance != nil && *site.LastMaintenance > 0 {
			seconds := int64(*site.LastMaintenance)
			ns := int64((*site.LastMaintenance - float64(seconds)) * float64(time.Second))
			tm := time.Unix(seconds, ns).UTC()
			_siteTime := tm
			out.Sites = append(out.Sites, SiteHealth{Name: site.Name, Version: site.Version, Status: site.Status, Observations: site.Observations, VerifiedOutcomes: site.VerifiedOutcomes, FastServed: site.FastServed, Coverage: site.Coverage, FalseServes: site.FalseServes, LastMaintenance: &_siteTime, ModelCallsAvoided: site.Savings.ModelCallsAvoided, SavingsBasis: site.Savings.Basis})
		} else {
			out.Sites = append(out.Sites, SiteHealth{Name: site.Name, Version: site.Version, Status: site.Status, Observations: site.Observations, VerifiedOutcomes: site.VerifiedOutcomes, FastServed: site.FastServed, Coverage: site.Coverage, FalseServes: site.FalseServes, ModelCallsAvoided: site.Savings.ModelCallsAvoided, SavingsBasis: site.Savings.Basis})
		}
	}
	return out, nil
}

func (b *Bridge) Maintenance(ctx context.Context) error {
	var out Response
	if err := b.call(ctx, Request{Op: "maintenance"}, &out); err != nil {
		return err
	}
	if !out.OK {
		return errors.New(out.Error)
	}
	return nil
}

func (b *Bridge) call(ctx context.Context, request Request, out *Response) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if ctx == nil {
		ctx = context.Background()
	}
	requestID := fmt.Sprintf("req-%d", b.seq.Add(1))
	if err := b.ensureStartedLocked(ctx); err != nil {
		return err
	}
	payload, err := json.Marshal(map[string]any{"id": requestID, "op": request.Op, "state": request.State, "safe_choice": request.SafeChoice, "correlation_id": request.CorrelationID, "decision_id": request.DecisionID, "quality": request.Quality, "verifier": request.Verifier, "verifier_version": request.VerifierVersion, "evidence": request.Evidence})
	if err != nil {
		return err
	}
	if _, err := b.stdin.Write(append(payload, '\n')); err != nil {
		b.stopLocked()
		return fmt.Errorf("write local Ink bridge request: %w", err)
	}
	timer := time.NewTimer(requestTimeout)
	defer timer.Stop()
	select {
	case line := <-b.lines:
		if line.err != nil {
			b.stopLocked()
			return fmt.Errorf("read local Ink bridge response: %w", line.err)
		}
		if err := json.Unmarshal(line.line, out); err != nil {
			b.stopLocked()
			return fmt.Errorf("decode local Ink bridge response: %w", err)
		}
		if out.ID != requestID {
			b.stopLocked()
			return errors.New("local Ink bridge response id mismatch")
		}
		return nil
	case <-ctx.Done():
		b.stopLocked()
		return ctx.Err()
	case <-timer.C:
		b.stopLocked()
		return errors.New("local Ink bridge request timed out")
	}
}

func (b *Bridge) ensureStartedLocked(ctx context.Context) error {
	if b.cmd != nil && b.cmd.Process != nil {
		return nil
	}
	if time.Since(b.lastStart) < restartDelay {
		return errors.New("local Ink bridge restart backoff")
	}
	b.lastStart = time.Now()
	py, err := source.ReadFile("bridge.py")
	if err != nil {
		return err
	}
	migration, err := source.ReadFile("db_migration.py")
	if err != nil {
		return err
	}
	interpreter := strings.TrimSpace(os.Getenv("INK_PYTHON"))
	if interpreter == "" {
		interpreter = "python3"
	}
	// Isolated mode ignores ambient PYTHONPATH/user-site injections. The packaged
	// Desktop process supplies its private site-packages path explicitly; local
	// development may continue to use a developer-selected interpreter.
	bootstrap := "import os,sys; p=os.environ.get('INK_SITE_PACKAGES'); sys.path.insert(0,p) if p else None; exec(compile(" + strconv.Quote(string(migration)) + ", '<inkway-ink-state-migration>', 'exec')); exec(compile(" + strconv.Quote(string(py)) + ", '<inkway-ink-bridge>', 'exec'))"
	cmd := exec.Command(interpreter, "-I", "-u", "-c", bootstrap)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	cmd.Stderr = io.Discard
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start local Ink bridge: %w", err)
	}
	lines := make(chan lineResult, 1)
	scannerStop := make(chan struct{})
	b.cmd, b.stdin, b.lines, b.scannerStop = cmd, stdin, lines, scannerStop
	go func() {
		defer close(lines)
		send := func(result lineResult) bool {
			select {
			case lines <- result:
				return true
			case <-scannerStop:
				return false
			}
		}
		scanner := bufio.NewScanner(stdout)
		scanner.Buffer(make([]byte, 4096), 1<<20)
		for scanner.Scan() {
			if !send(lineResult{line: append([]byte(nil), scanner.Bytes()...)}) {
				return
			}
		}
		err := scanner.Err()
		if err == nil {
			err = io.EOF
		}
		send(lineResult{err: err})
	}()
	var hello Response
	// Initial handshake shares the same response reader as normal requests.
	id := fmt.Sprintf("req-%d", b.seq.Add(1))
	data, _ := json.Marshal(map[string]string{"id": id, "op": "hello"})
	if _, err := stdin.Write(append(data, '\n')); err != nil {
		b.stopLocked()
		return err
	}
	select {
	case line := <-b.lines:
		if line.err != nil {
			b.stopLocked()
			return line.err
		}
		if err := json.Unmarshal(line.line, &hello); err != nil || !hello.OK || hello.ID != id {
			b.stopLocked()
			return errors.New("local Ink bridge handshake failed")
		}
		if hello.Version != "0.6.0rc2" {
			b.stopLocked()
			return fmt.Errorf("local Ink engine version is incompatible: %q", hello.Version)
		}
		if hello.ProtocolVersion != 1 {
			b.stopLocked()
			return fmt.Errorf("local Ink bridge protocol is incompatible: %d", hello.ProtocolVersion)
		}
		if !hello.ModelVerified {
			b.stopLocked()
			if hello.ModelError == "" {
				return errors.New("local Ink trained model is unavailable or failed integrity verification")
			}
			return fmt.Errorf("local Ink trained model is unavailable: %s", hello.ModelError)
		}
		if hello.ModelName != "ink-decision-v1" || hello.ModelVersion == "" || len(hello.ModelSHA256) != 64 {
			b.stopLocked()
			return errors.New("local Ink model does not match the compatibility manifest")
		}
		b.logger.Info("Ink engine ready", "version", hello.Version, "model", hello.ModelName, "model_version", hello.ModelVersion, "model_sha256", hello.ModelSHA256)
	case <-ctx.Done():
		b.stopLocked()
		return ctx.Err()
	case <-time.After(startupTimeout):
		b.stopLocked()
		return errors.New("local Ink bridge startup handshake timed out")
	}
	return nil
}

func (b *Bridge) Close() {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.cmd == nil {
		return
	}
	if b.stdin != nil {
		_, _ = b.stdin.Write([]byte(`{"id":"shutdown","op":"shutdown"}` + "\n"))
	}
	select {
	case <-b.lines:
	case <-time.After(2 * time.Second):
	}
	if b.stdin != nil {
		_ = b.stdin.Close()
	}
	cmd := b.cmd
	stopScanner := b.scannerStop
	b.cmd, b.stdin, b.lines, b.scannerStop = nil, nil, nil, nil
	if stopScanner != nil {
		close(stopScanner)
	}
	done := make(chan struct{})
	go func() { _ = cmd.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
		<-done
	}
}

func (b *Bridge) stopLocked() {
	if b.stdin != nil {
		_ = b.stdin.Close()
	}
	if b.cmd != nil && b.cmd.Process != nil {
		if b.scannerStop != nil {
			close(b.scannerStop)
			b.scannerStop = nil
		}
		_ = b.cmd.Process.Kill()
		_, _ = b.cmd.Process.Wait()
	}
	b.cmd, b.stdin, b.lines, b.scannerStop = nil, nil, nil, nil
}
