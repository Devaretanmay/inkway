# Ink release debt

Scope: final Phase 5 hardening for the Inbox, Issues, Agents, FastPaths, and Settings release-candidate workflow. Historical Inkway features remain hidden or internal when they share compatibility paths; no new DecisionSites or providers are in scope.

## Closed in this pass

- Handler tests now create an isolated database from the configured managed PostgreSQL service, apply the application's complete migration chain, and tear down only that disposable database. Root cause: package tests previously inherited a hard-coded legacy `DATABASE_URL` when the caller had not sourced the checkout environment, so they silently used an old local schema without `workspace`.
- Added a canonical clean-database handler and Go test path.
- Fixed a race between the Ink bridge response scanner and shutdown.
- Documented bootstrap, first issue flow, runtimes, providers, agents, FastPaths, and the security boundary.
- Replaced the legacy root README with Ink release-candidate setup and workflow guidance.
- Full race-enabled Go suite passed from a disposable database after limiting test concurrency to avoid macOS process-tree cleanup failures. All 564 migrations applied before tests; the handler package passed its race-enabled run.
- Added deterministic native-provider coverage for missing and excessive `Retry-After`, cancellation during a retry wait, and exhausted quota. Exhausted quota is classified distinctly and does not trigger an automatic retry.
- Core tests passed (171 files, 2,211 tests); web tests passed (35 files, 279 tests); desktop tests passed (60 files, 667 tests). Focused views tests for release pages and branding passed (five files, 59 tests).
- Production web build, desktop build, unsigned macOS app packaging, and the 1440/1280 product smoke journey completed. The packaged app launched to the Ink sign-in screen. Smoke screenshots exercise seeded issue/review UI; they do not claim a real agent run.
- A credential-pattern scan covered 6,498 tracked/non-ignored files and found 14 matches; review classified all as redacted test fixtures or example placeholders. Three runtime log files had no provider-key or bearer-token matches. No secret values were emitted.

## Must fix before public alpha

- Complete the new-user onboarding flow: current first-run still asks a personalization questionnaire and creates/opens the legacy onboarding agent flow instead of offering Runtime → optional Provider → CLI or Native Agent → Repository → First Issue. CLI onboarding must work without provider keys.
- The full views suite has not completed cleanly. Its latest run finished 5,871 tests, with one failing test and six Vitest fork-worker startup timeouts before all 475 files completed. After updating stale branding and hidden-navigation expectations, focused coverage passed (8 files, 94 tests). Re-run the full suite in a stable worker environment before alpha.
- Complete the full TypeScript lint/typecheck matrix; views/core and desktop typechecks passed, but the repository-wide lint command was not run.
- Exercise fresh desktop launch with an authenticated account, runtime reconnect, provider settings, agent creation, issue execution, review, and cancellation in the desktop UI. This pass verified packaged launch/sign-in and browser issue/review smoke only; no authenticated runtime flow was exercised.
- Replace or relabel normal-use links/copy that still point to `multica.ai` in the old runtime guide, help launcher, and legacy Skills surface. No verified Ink destination was available to substitute.
- Finish focused runtime verification of credential relay authorization/redaction, tool path/symlink handling, environment inheritance, output limits, and redirect behavior. `docs/security.md` records code-inspection findings, not a formal penetration test.
- Verify upgrade from a representative existing schema where a maintained historical fixture exists. Fresh-database migrations through migration 564 are covered by the test harness.

## Acceptable post-alpha

- Apple notarization and Windows signing require distribution credentials that are unavailable here.
- Live OpenAI and Anthropic calls require credentials that are unavailable here; their adapters are validated by deterministic mocked HTTP tests.
- Live Groq capacity can vary with free-tier limits; no large coding task should be used as a quota test.
- Full mobile onboarding and mobile branding migration are outside the desktop-first release-candidate scope.
- Web production build (Next static output completed) and an unsigned/dev macOS `Ink.app` package are available; signing and notarization remain distribution work only.

## Internal compatibility debt

- Retained Inkway package aliases, environment variable names, protocol, database identifiers, migrations, CLI configuration, upstream repository identity, and hidden legacy routes are listed in `docs/ink-branding-debt.md`.

## Optional future product work

- Remove legacy frontend/backend routes only after proving they have no required shared behavior or persisted data dependencies.
- Add further provider or runtime integrations only when required by user demand; Phase 5 adds no new providers, DecisionSites, or orchestration features.

## Hidden route disposition

- **KEEP INTERNAL:** chat, My Issues, projects, squads, autopilots, usage/analytics, skills, and collaboration settings that remain dependencies of existing APIs, assignment models, inbox notifications, shared components, or persisted rows.
- **REMOVE FRONTEND:** none in this pass; route reachability and all shared imports were not proven safe for deletion.
- **REMOVE FULLY:** none. Backend removal would require schema/runtime archaeology outside the safe release scope.
- **DEFER:** mobile and historical marketing/legal routes. They are outside the release-candidate navigation and do not block the desktop-first release.

These are scope classifications, not claims that every legacy deep link has been physically disabled. The primary navigation remains limited to Inbox, Issues, Agents, FastPaths, and Settings.

## Product definition

A FastPath is a locally served bounded agent decision that Ink independently verified against real outcomes. It is a lifecycle-qualified decision optimization, not a general response cache or a promise of task success.
