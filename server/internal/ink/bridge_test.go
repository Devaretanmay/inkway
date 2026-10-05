package ink

import (
	"context"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestBridgeHandshakeDecisionAndShutdown(t *testing.T) {
	python := filepath.Join(t.TempDir(), "python")
	program := `#!/bin/sh
while IFS= read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
  op=$(printf '%s' "$line" | sed -n 's/.*"op":"\([^"]*\)".*/\1/p')
  case "$op" in
	  hello) printf '{"id":"%s","ok":true,"version":"0.6.0rc2","protocol_version":1,"model_name":"ink-decision-v1","model_version":"1.0.0","model_sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","model_verified":true}\n' "$id" ;;
    decide) printf '{"id":"%s","ok":true,"choice":"resume_session","source":"fallback","decision_id":"d1","site_version":"v1"}\n' "$id" ;;
    shutdown) printf '{"id":"%s","ok":true}\n' "$id"; break ;;
  esac
done
`
	if err := os.WriteFile(python, []byte(program), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("INK_PYTHON", python)
	b := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	// Race-enabled package runs also start the local interpreter under heavy
	// compile/test load. Leave room for process startup while still bounding a
	// hung bridge well below the production request timeout.
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := b.Start(ctx); err != nil {
		t.Fatal(err)
	}
	d, err := b.Decide(ctx, State{Provider: "codex", FailureReason: "timeout", RetryAttempt: 1, PreviousSessionExists: true}, "fresh_session", "task-private-correlation")
	if err != nil {
		t.Fatal(err)
	}
	if d.Choice != "resume_session" || d.Source != "fallback" || d.DecisionID == nil || *d.DecisionID != "d1" {
		t.Fatalf("unexpected decision: %+v", d)
	}
	b.Close()
}

func TestBridgeRejectsUndeclaredRecoveryChoice(t *testing.T) {
	python := filepath.Join(t.TempDir(), "python")
	program := `#!/bin/sh
while IFS= read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
  op=$(printf '%s' "$line" | sed -n 's/.*"op":"\([^"]*\)".*/\1/p')
  case "$op" in
	  hello) printf '{"id":"%s","ok":true,"version":"0.6.0rc2","protocol_version":1,"model_name":"ink-decision-v1","model_version":"1.0.0","model_sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","model_verified":true}\n' "$id" ;;
    decide) printf '{"id":"%s","ok":true,"choice":"switch_provider"}\n' "$id" ;;
  esac
done
`
	if err := os.WriteFile(python, []byte(program), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("INK_PYTHON", python)
	b := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	defer b.Close()
	if _, err := b.Decide(context.Background(), State{}, "fresh_session", "task"); err == nil {
		t.Fatal("expected undeclared choice rejection")
	}
}

func TestEnabled(t *testing.T) {
	for _, tc := range []struct {
		value string
		want  bool
	}{{"", false}, {"false", false}, {"true", true}, {"1", true}, {"yes", true}} {
		t.Setenv("INK_ENABLED", tc.value)
		if got := Enabled(); got != tc.want {
			t.Errorf("Enabled(%q) = %v, want %v", tc.value, got, tc.want)
		}
	}
}
