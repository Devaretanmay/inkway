package daemon

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/Devaretanmay/inkway/server/internal/nativeagent"
)

func TestDecodeNativeAgentConfigAllowsAgentModelFallback(t *testing.T) {
	cfg, enabled, err := decodeNativeAgentConfig(json.RawMessage(`{"execution_type":"native","provider":"groq"}`))
	if err != nil || !enabled || cfg.Model != "" {
		t.Fatalf("config=%+v enabled=%v err=%v", cfg, enabled, err)
	}
}

func TestNativeRunAccountingReportsProviderAndRealDecisionSources(t *testing.T) {
	comment := nativeCompletionComment(nativeagent.Result{
		CloudCalls:        3,
		Usage:             nativeagent.Usage{InputTokens: 120, OutputTokens: 15},
		RecoveryDecisions: 2,
		RecoverySources:   map[string]int{"fast_path": 1, "fallback": 1},
		TestsRun:          1, TestsPassed: 1,
	})
	for _, want := range []string{"3 provider requests", "120 input / 15 output tokens", "2 Ink recovery decisions", "fast_path 1", "fallback 1", "1 run, 1 passed, 0 failed"} {
		if !strings.Contains(comment, want) {
			t.Errorf("accounting omitted %q: %s", want, comment)
		}
	}
}

func TestDecodeNativeAgentConfigLeavesCLIUntouched(t *testing.T) {
	_, enabled, err := decodeNativeAgentConfig(json.RawMessage(`{"execution_type":"cli"}`))
	if err != nil || enabled {
		t.Fatalf("enabled=%v err=%v", enabled, err)
	}
}
