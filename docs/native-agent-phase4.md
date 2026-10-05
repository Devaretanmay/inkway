# Native API agents — Phase 4 status

Phase 3 is **complete**. Its remote-teacher, qualified FastPath, and real CLI recovery evidence is recorded separately in [ink-phase3-proof.md](ink-phase3-proof.md). The later Groq rate-limit result is an operational capacity limit, not a Phase 3 architecture failure.

Phase 4 implementation meets the zero-budget acceptance policy in this checkout. Groq is the only live remote provider currently available and its transport has passed a real credential validation. OpenAI and Anthropic live checks are optional and are recorded as **blocked by credential availability**; their adapters pass deterministic HTTP tests. No paid credentials are required.

## Implemented

- Native agents run through the daemon's real `NativeAgentRunner`; existing CLI agents keep their established execution path.
- OpenAI Responses, Anthropic Messages, and Groq OpenAI-compatible Chat Completions adapters normalize text, tools, usage, provider errors, and cancellation behavior.
- Provider credentials can be resolved from environment variables or an OS keyring, scoped to runtime and provider. The server database does not receive API keys. The `inkway runtime credentials` CLI stores, checks, deletes, or explicitly validates runtime-local credentials; input can be hidden at the terminal or piped through stdin.
- Agent creation selects CLI or Native API and, for Native, the provider and model.
- Native tools list, read, search, write, patch, run bounded commands, and collect diffs in a real repository. Path escape, sensitive files, shell invocation, inherited provider secrets, output size, command time, and serialized model-context size are bounded.
- Provider calls send JSON-compatible headers and a product User-Agent. Redirects are disabled for OpenAI-compatible providers, credential echoes are redacted, the Groq response ceiling is conservative, and numeric `Retry-After` is honored after Ink selects recovery.
- Native recovery uses the existing `coding_agent.recovery_action` DecisionSite; no additional speculative sites have been added.
- Native run completion and provider-limit failures include provider-request counts, provider-reported token usage, factual Ink source counts (`fast_path`/`fallback`), tool/test counts, and changed files in the visible task result.

## Controlled local integration evidence

`go test ./internal/nativeagent -run TestControlledLocalNativeRunEditsAndTestsRepository -count=1` runs the real runner with a deterministic local provider implementation. The runner writes `calculator_test.go` into an isolated Git repository, executes the real `go test ./...` command, observes one passing test, and reports the changed file. This is controlled/local tool-loop validation, not remote-provider quality evidence. The test does not inject Ink telemetry or claim a real cloud call.

The separate Groq validation succeeded for `openai/gpt-oss-120b`; provider usage reported 75 input and 32 output tokens. A later native issue encountered the account's on-demand TPM limit (HTTP 429), after which the actual recovery site selected `fresh_session` from `fallback`. That run is a truthful capacity-limited failure, not a successful coding completion. No further quota is spent to finish a large task.

## Acceptance checklist

- [x] Phase 3 accepted and documented independently.
- [x] Groq live transport validation recorded.
- [x] Native runner performs real file and test tools with a deterministic local provider in a controlled integration test.
- [x] Existing CLI execution path remains present; native routing is opt-in through agent configuration.
- [x] No extra Ink DecisionSites and no synthetic Ink telemetry in the controlled local test.
- [x] Desktop Provider Settings UI for runtime-local OpenAI, Anthropic, and Groq credentials, status, removal, and explicit connection checks.
- [x] Credential input is relayed through Desktop's narrow IPC bridge into the local CLI over stdin; only the OS credential store persists it, and the server never receives it.
- [x] Deterministic mocked HTTP coverage for OpenAI and Anthropic text/tool request-response paths, usage, malformed bodies, normalized errors, credential redaction, and retry delay.
- [x] Native API agent draft creates provider/model runtime configuration; daemon accepts native configuration and leaves CLI configurations on the established path.
- [x] Per-run provider-request, provider-usage, and Ink FastPath/fallback accounting included in the task result shown in run detail.
- [x] Controlled zero-cost Native run completes through the real runner and real repository file/test tools using a deterministic local provider.
- [x] Existing CLI execution remains the default for agents without Native configuration; daemon/CLI package regression tests pass.
- [x] Secret scan and relevant focused test suites pass.

OpenAI and Anthropic live verification are optional; until matching credentials exist, report each as **blocked by credential availability**. Their absence does not block Phase 4 completion. A free-tier Groq capacity response must be surfaced as provider rate limiting and must not be described as an architectural failure.

## Verification notes

- `go test ./internal/nativeagent -count=1` — passes, including both provider mock adapters, recovery routing, and the full controlled local edit-and-test run.
- `go test ./internal/daemon ./cmd/inkway -count=1` — passes. The linker prints a warning for an absent optional Homebrew MySQL search path; it does not affect the test result.
- Desktop main/preload/renderer TypeScript checks pass; the Provider Settings UI test passes.
- `packages/core` draft tests — 22 pass, including provider/model request creation and existing CLI-default behavior.
- Desktop main/preload/renderer TypeScript checks passed after adding the local credential relay and Provider Settings page.
- Provider tests cover OpenAI Responses text and function calls, OpenAI-compatible routing, Anthropic Messages and tool results, malformed JSON, normalized authentication/rate-limit/server errors, credential redaction, JSON/User-Agent headers, and bounded retry delay.
- `packages/core` and `packages/views` typechecks passed; Desktop main/preload/renderer typechecks passed.
- The broader handler package test setup previously stopped because its configured test database lacked the `workspace` relation. This does not affect the passing native runner, daemon, CLI, or UI tests listed above; no schema or test thresholds were altered to mask it.
