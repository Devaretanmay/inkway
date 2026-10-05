package ink

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

// This integration proof runs only when an actual packaged runtime has been
// staged by apps/desktop/scripts/package-ink-runtime.mjs. It exercises
// the shipped SDK, MLX model, JSONL bridge, DecisionSite lifecycle, verifier,
// FastPath serving, and SQLite persistence without a mocked process.
func TestBundledInkModelLifecycleAndPersistence(t *testing.T) {
	root := os.Getenv("INKWAY_INK_BUNDLE")
	if root == "" {
		t.Skip("set INKWAY_INK_BUNDLE to a staged Inkway runtime to run the packaged-engine proof")
	}
	manifestBytes, err := os.ReadFile(filepath.Join(root, "compatibility.json"))
	if err != nil {
		t.Fatal(err)
	}
	var manifest struct {
		InkwayVersion string `json:"inkway_version"`
	}
	if err := json.Unmarshal(manifestBytes, &manifest); err != nil || manifest.InkwayVersion == "" {
		t.Fatalf("invalid runtime compatibility manifest: %v", err)
	}
	t.Setenv("INK_ENABLED", "true")
	t.Setenv("INK_PYTHON", filepath.Join(root, "python", "cpython-3.13.12-macos-aarch64-none", "bin", "python3.13"))
	t.Setenv("INK_SITE_PACKAGES", filepath.Join(root, "site-packages"))
	t.Setenv("INK_MODEL_DIR", filepath.Join(root, "model"))
	t.Setenv("INK_RUNTIME_MANIFEST", filepath.Join(root, "compatibility.json"))
	t.Setenv("INK_INKWAY_VERSION", manifest.InkwayVersion)
	stateRoot := os.Getenv("INKWAY_INK_TEST_STATE_DIR")
	if stateRoot == "" {
		stateRoot = filepath.Join(t.TempDir(), "support")
	} else if err := os.RemoveAll(stateRoot); err != nil {
		t.Fatal(err)
	}
	t.Setenv("INK_DB_PATH", filepath.Join(stateRoot, "ink", "decisions.db"))
	for _, key := range []string{"INK_TEACHER_BASE_URL", "INK_TEACHER_API_KEY", "INK_TEACHER_MODEL", "INK_DISABLED", "INK_MODEL_DISABLED", "INK_DISABLE_FAST_PATH"} {
		t.Setenv(key, "")
	}

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	bridge := New(logger)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	if err := bridge.Start(ctx); err != nil {
		t.Fatalf("packaged engine failed startup/version/model verification: %v", err)
	}

	state := State{Provider: "codex", FailureReason: "agent_error.timeout", RetryAttempt: 1, PreviousSessionExists: true}
	const expected = "fresh_session"
	transitions := make([]string, 0, 5)
	observations, outcomes := 0, 0
	var served Decision
	for observations < 5000 {
		decision, err := bridge.Decide(ctx, state, expected, fmt.Sprintf("controlled-packaged-model-proof-%d", observations+1))
		if err != nil {
			t.Fatalf("packaged DecisionSite decision %d failed: %v", observations+1, err)
		}
		observations++
		if decision.DecisionID == nil || *decision.DecisionID == "" {
			t.Fatalf("decision %d did not produce an SDK outcome handle", observations)
		}

		// Independent controlled verifier: this bounded fixture's safe action is
		// fresh_session, and the observed response must remain in the declared
		// choice set. The verifier records only its factual comparison result.
		verified := decision.Choice == expected
		quality := 0.0
		evidence := map[string]any{"controlled_fixture": "packaged_recovery_state_v1", "expected_choice": expected, "observed_choice": decision.Choice, "independent_check": verified}
		if verified {
			quality = 1
		}
		if err := bridge.RecordOutcome(ctx, *decision.DecisionID, quality, "inkway_packaged_fixture_verifier", "1", evidence); err != nil {
			t.Fatalf("record SDK outcome %d: %v", observations, err)
		}
		outcomes++
		if decision.Source == "fast_path" {
			served = decision
			break
		}

		if observations%20 == 0 {
			if err := bridge.Maintenance(ctx); err != nil {
				t.Fatalf("SDK maintenance after %d outcomes: %v", outcomes, err)
			}
			snapshot, err := bridge.Snapshot(ctx)
			if err != nil {
				t.Fatalf("read SDK lifecycle state: %v", err)
			}
			for _, site := range snapshot.Sites {
				if site.Name == "coding_agent.recovery_action" && (len(transitions) == 0 || transitions[len(transitions)-1] != site.Status) {
					transitions = append(transitions, site.Status)
				}
			}
		}
	}
	if served.Source != "fast_path" || served.Choice != expected {
		t.Fatalf("packaged Ink did not serve the qualified local decision after %d observations; source=%q choice=%q transitions=%v", observations, served.Source, served.Choice, transitions)
	}
	bridge.Close()

	restarted := New(logger)
	defer restarted.Close()
	if err := restarted.Start(ctx); err != nil {
		t.Fatalf("restart packaged engine: %v", err)
	}
	persisted, err := restarted.Snapshot(ctx)
	if err != nil {
		t.Fatalf("read persisted SDK state after restart: %v", err)
	}
	postRestartAttempts, postRestartOutcomes := 0, 0
	var persistedDecision Decision
	for postRestartAttempts = 1; postRestartAttempts <= 100; postRestartAttempts++ {
		persistedDecision, err = restarted.Decide(ctx, state, expected, fmt.Sprintf("controlled-packaged-model-proof-after-restart-%d", postRestartAttempts))
		if err != nil {
			t.Fatalf("post-restart SDK decision: %v", err)
		}
		if persistedDecision.DecisionID == nil || *persistedDecision.DecisionID == "" {
			t.Fatal("post-restart SDK decision did not produce an outcome handle")
		}
		verified := persistedDecision.Choice == expected
		quality := 0.0
		if verified {
			quality = 1
		}
		if err := restarted.RecordOutcome(ctx, *persistedDecision.DecisionID, quality, "inkway_packaged_fixture_verifier", "1", map[string]any{"controlled_fixture": "packaged_recovery_state_v1", "expected_choice": expected, "observed_choice": persistedDecision.Choice, "independent_check": verified}); err != nil {
			t.Fatalf("persist post-restart outcome: %v", err)
		}
		postRestartOutcomes++
		if persistedDecision.Source == "fast_path" {
			break
		}
	}
	if persistedDecision.Source != "fast_path" || persistedDecision.Choice != expected {
		t.Fatalf("persisted FastPath was not served after restart in %d attempts: decision=%+v sites=%+v", postRestartAttempts-1, persistedDecision, persisted.Sites)
	}
	t.Logf("engine=0.6.0rc2 model=ink-decision-v1/%s decision_site=coding_agent.recovery_action source=fast_path choice=%s observations=%d outcomes=%d transitions=%v persisted_after_restart=true post_restart_attempts=%d post_restart_outcomes=%d snapshot_sites=%d", mustRuntimeVersion(t, root), served.Choice, observations, outcomes, transitions, postRestartAttempts, postRestartOutcomes, len(persisted.Sites))
}

func TestBundledInkTrainedModelInference(t *testing.T) {
	root := os.Getenv("INKWAY_INK_BUNDLE")
	if root == "" {
		t.Skip("set INKWAY_INK_BUNDLE to an installed Inkway bundle to run trained-model inference proof")
	}
	python := filepath.Join(root, "python", "cpython-3.13.12-macos-aarch64-none", "bin", "python3.13")
	sitePackages := filepath.Join(root, "site-packages")
	model := filepath.Join(root, "model")
	state := `{"provider":"codex","failure_reason":"agent_error.timeout","retry_attempt":1,"previous_session_exists":true}`
	script := `import json,os,sys
sys.path.insert(0, os.environ["INK_SITE_PACKAGES"])
from ink import DecisionSite
from ink.internal.engines import DecisionModelEngine
site = DecisionSite(name="coding_agent.recovery_action", state_schema={"provider":"string","failure_reason":"string","retry_attempt":"integer","previous_session_exists":"boolean"}, choices=("resume_session","fresh_session"), fallback_revision="1")
state = json.loads(os.environ["INKWAY_MODEL_PROOF_STATE"])
engine = DecisionModelEngine(checkpoint=os.environ["INK_MODEL_DIR"])
payload = engine.compile(site, [{"state":state,"choice":"fresh_session"}])
choice, confidence = engine.predict(payload, state)
assert payload["engine"] == "decision" and engine._agents
assert choice in site.choices and 0 <= confidence <= 1
print(json.dumps({"engine":payload["engine"],"model":"ink-decision-v1","choice":choice,"confidence":confidence,"loaded":bool(engine._agents)}))`
	home := t.TempDir()
	cmd := exec.CommandContext(context.Background(), python, "-I", "-c", script)
	cmd.Env = []string{
		"HOME=" + home,
		"PATH=/usr/bin:/bin",
		"INK_SITE_PACKAGES=" + sitePackages,
		"INK_MODEL_DIR=" + model,
		"INKWAY_MODEL_PROOF_STATE=" + state,
	}
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("bundled Ink local-model inference failed: %v: %s", err, output)
	}
	t.Logf("python=%s model_path=%s isolated_home=%s result=%s", python, model, home, output)
}

func TestBundledInkRejectsMissingModelAndIncompatibleEngine(t *testing.T) {
	root := os.Getenv("INKWAY_INK_BUNDLE")
	if root == "" {
		t.Skip("set INKWAY_INK_BUNDLE to a staged Inkway runtime to run packaged failure-mode proofs")
	}
	manifestBytes, err := os.ReadFile(filepath.Join(root, "compatibility.json"))
	if err != nil {
		t.Fatal(err)
	}
	var runtimeManifest map[string]any
	if err := json.Unmarshal(manifestBytes, &runtimeManifest); err != nil {
		t.Fatal(err)
	}
	configure := func(t *testing.T, modelPath, manifestPath, statePath string) {
		t.Helper()
		var metadata struct {
			InkwayVersion string `json:"inkway_version"`
		}
		if err := json.Unmarshal(manifestBytes, &metadata); err != nil {
			t.Fatal(err)
		}
		t.Setenv("INK_ENABLED", "true")
		t.Setenv("INK_PYTHON", filepath.Join(root, "python", "cpython-3.13.12-macos-aarch64-none", "bin", "python3.13"))
		t.Setenv("INK_SITE_PACKAGES", filepath.Join(root, "site-packages"))
		t.Setenv("INK_MODEL_DIR", modelPath)
		t.Setenv("INK_RUNTIME_MANIFEST", manifestPath)
		t.Setenv("INK_INKWAY_VERSION", metadata.InkwayVersion)
		t.Setenv("INK_DB_PATH", statePath)
		t.Setenv("INK_TEACHER_BASE_URL", "")
		t.Setenv("INK_TEACHER_API_KEY", "")
		t.Setenv("INK_TEACHER_MODEL", "")
	}

	t.Run("missing model fails closed", func(t *testing.T) {
		configure(t, filepath.Join(t.TempDir(), "missing-model"), filepath.Join(root, "compatibility.json"), filepath.Join(t.TempDir(), "state", "decisions.db"))
		bridge := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
		defer bridge.Close()
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := bridge.Start(ctx); err == nil || bridge.Available() {
			t.Fatalf("missing bundled model must not mark Ink ready: err=%v available=%v", err, bridge.Available())
		}
	})

	t.Run("incompatible engine fails closed", func(t *testing.T) {
		configure(t, filepath.Join(root, "model"), filepath.Join(t.TempDir(), "incompatible.json"), filepath.Join(t.TempDir(), "state", "decisions.db"))
		incompatible := make(map[string]any, len(runtimeManifest))
		for key, value := range runtimeManifest {
			incompatible[key] = value
		}
		incompatible["ink_version"] = "0.0.0"
		manifestPath := os.Getenv("INK_RUNTIME_MANIFEST")
		encoded, err := json.Marshal(incompatible)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(manifestPath, encoded, 0o600); err != nil {
			t.Fatal(err)
		}
		bridge := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
		defer bridge.Close()
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := bridge.Start(ctx); err == nil || bridge.Available() {
			t.Fatalf("incompatible engine must not mark Ink ready: err=%v available=%v", err, bridge.Available())
		}
	})
}

func mustRuntimeVersion(t *testing.T, root string) string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(root, "compatibility.json"))
	if err != nil {
		t.Fatal(err)
	}
	var manifest struct {
		ModelVersion string `json:"model_version"`
	}
	if err := json.Unmarshal(data, &manifest); err != nil {
		t.Fatal(err)
	}
	return manifest.ModelVersion
}
