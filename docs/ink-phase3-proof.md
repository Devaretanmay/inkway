# Ink Phase 3 proof closure

Recorded 2026-10-04 in the local development environment. The lifecycle workload is controlled plumbing validation; it is not a cloud-model quality experiment.

## Remote teacher transport

Previously verified independently against the configured Groq OpenAI-compatible teacher. The key is not included here. This proof establishes teacher transport only.

## Local FastPath lifecycle

Validated through Ink 0.6.0rc1's public SDK on the existing `coding_agent.recovery_action` site using a deterministic local fallback, public `decide` and outcome-recording APIs, independent deterministic verification, and normal compile/calibrate/evaluate/maintenance/qualification. Qualification thresholds were unchanged. 1,603 observations/outcomes were recorded; the site traversed OBSERVE → CANDIDATE → SHADOW → VERIFIED → ACTIVE, then returned a real `source=fast_path` decision (`resume_session`). The run was explicitly a controlled lifecycle/integration check.

## Real runtime retry control

A controlled Inkway issue was assigned to the installed Codex CLI agent (`gpt-5.5`). The initial real agent attempt failed with `agent_error.provider_network` and retained session `01a104a1-0e9c-75e2-b643-36a34b47f4c1`. The normal retry was attempt 2, task `01a104a1-8a7f-7130-8907-89b354fd1ba0`, with parent lineage and failure reason delivered to the daemon. The existing site returned `fresh_session`, source `fallback` (local deterministic fallback; no cloud call). The daemon recorded `eligible=true`, selected `fresh_session`, and started a new Codex thread `01a104a1-9799-7033-aede-cd2140509a88` with `resume_session=false`. The retry created and verified the requested proof file, posted its issue result, moved DEV-6 to `in_review`, and completed successfully.

The SDK database `/tmp/ink-phase3-recovery.db` records one decision and one independently verified outcome for this retry. Its decision was `fresh_session` / `fallback`; outcome quality was 1 with `same_terminal_failure_recurred=false`.

## Integration fix

The claim builder previously handled ordinary follow-ups before automatic retry lineage. A retry with `ForceFreshSession=false` therefore entered the ordinary resume branch and bypassed Ink. Automatic retry lineage now takes precedence in `server/internal/handler/daemon.go`; `go test -c ./internal/handler` and the focused daemon Ink recovery tests pass. The handler integration test remains dependent on the local test database schema, which was unavailable in its default test setup.
