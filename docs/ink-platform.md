# Ink runtime integration

The runtime uses the installed Ink SDK through one persistent local
Python JSONL bridge. Ink core stays a separate package and repository.
The Go daemon owns bridge startup and shutdown; bridge errors keep the existing
fresh-session retry behavior.

## Local setup

Phase 3 requires Ink SDK `0.6.0rc1` and Python 3.11, 3.12, or 3.13.
Install the pinned release:

```sh
python3.13 -m venv ~/.venvs/ink-platform
~/.venvs/ink-platform/bin/python -m pip install 'ink==0.6.0rc1'
```

For development against the sibling source checkout, install that exact local
package in an isolated environment:

```sh
python3.13 -m venv ~/.venvs/ink-platform
~/.venvs/ink-platform/bin/python -m pip install -e /path/to/ink
```

Set `INK_ENABLED=true` and `INK_PYTHON` to that environment's
Python executable before launching the daemon. The bridge rejects SDK versions
other than `0.6.0rc1`; this catches stale global Python installs. Ink's
model packages are part of its SDK dependencies. Provision the local model in
advance with `ink model-install`; set `INK_MODEL_DIR` only when
weights live at a non-default location. Missing model or checkpoint remains a
safe cloud/host fallback condition.

The SDK database defaults to `~/.ink/decisions.db`. Override it with
`INK_DB_PATH`. It stores local decisions, outcomes, qualification, and
artifacts; it is not copied into a task directory or uploaded to the server.

An optional OpenAI-compatible teacher uses environment variables only:

```text
INK_TEACHER_BASE_URL
INK_TEACHER_API_KEY
INK_TEACHER_MODEL
```

The key stays in the local daemon environment. If teacher configuration is
missing, invalid, or unavailable, the callback chooses the platform's existing
fresh-session retry mode. The bridge does not log request bodies, responses, or
credentials.

## First decision contract

`coding_agent.recovery_action` is registered as one SDK `DecisionSite`. Its
version is the SDK's contract hash over this schema, the choices, and fallback
revision `1`.

| State field | Type | Why it can repeat |
| --- | --- | --- |
| `provider` | string | A workspace reuses a small set of agent runtimes. |
| `failure_reason` | string | Server retries use a bounded failure taxonomy. |
| `retry_attempt` | integer | The server bounds automatic retry attempts. |
| `previous_session_exists` | boolean | Only a server-approved retry with a safe source session reaches this site. |

State excludes IDs, timestamps, prompts, logs, model output, and issue text.
Choices are exactly `resume_session` and `fresh_session`. The teacher returns a
strict JSON object containing one declared choice. Invalid output is rejected;
Ink records the host callback's safe choice as fallback.

The server creates and claims the retry before this site can run. It exposes
retry lineage and the parent failure only when the daemon advertises the
Ink capability, and only supplies a parent session after the server's
existing resume-safety checks pass. The integration cannot make a failed,
interrupted, or non-retryable run eligible for retry.

## Outcome verification

An outcome is recorded only after the runtime proves it enacted the selected
session mode. A retry is positive only when it completes and a subsequent
server read confirms the issue moved from before-review status to `in_review` or
`done`; completion alone is not proof. A retry is negative only when the same
classified terminal failure recurs. Different failures, missing session proof,
chat retries, unavailable issue status, and completed runs that leave the issue
in progress remain unverified.

Ink maintenance runs through the existing daemon lifecycle after every
20 terminal runs. Each call is bounded to one site, 100 rows, and one second.
The SDK controls compilation, evaluation, promotion, and demotion; the platform
does not edit lifecycle state.

## Server snapshot boundary

Only derived runtime health and per-site aggregates sync on the existing HTTP
heartbeat: lifecycle status, observation/outcome counts, FastPath serves,
coverage, false serves, last maintenance, and SDK-reported model-call savings
when the SDK declares its fixed-call basis. Runtime ID is included to scope the
snapshot. State, prompts, API keys, transcripts, SQLite rows, and model weights
stay local. The server snapshot is presentation data; Ink's local store
remains authoritative.
