# Issuway friendly-alpha verification

**Verdict: READY FOR FRIENDLY ALPHA**

## Six-step journey and real CLI run

Completed through the product UI with the locally authenticated Codex CLI; no paid provider quota was used. Created agent **Issuway Alpha Codex** (`a0a83c1a-ce9b-40f3-9869-cc48e6e6b8ce`) on Codex runtime `c0ae9ba0-7077-4d5d-a659-7e04b4732473` (gpt-5.5). Created and assigned issue **DEV-8** (`01a10876-80a0-7da4-ae99-4b60b63b9b38`); the product created and claimed run **01a10877-39fe-74af-84c4-9cf4407fa3bb**.

- Started: `2026-10-05T01:19:53+05:30`
- Completed: `2026-10-05T01:20:45+05:30`
- Runtime: local Codex CLI, gpt-5.5
- Actual change: `alpha-proof.txt`, containing `Issuway alpha proof` followed by a newline
- Independent verification: `printf 'Issuway alpha proof\n' | cmp - alpha-proof.txt && printf 'matches expected content\n'` → `matches expected content`
- Final issue state after acceptance: **Done**

The real completed run, provider/tool, model, agent summary, changed file, verification command/result, and truthful “Tests run: none” appear in Review. No Review result was seeded. Accept changed Review → Done through the UI.

A second real UI-created Codex run, DEV-9 (`01a10883-8568-74ca-a498-fa31c1694714`), completed run `01a10883-b94a-79a8-9a53-5c0b4400ef27`, created and verified `reopen-proof.txt`; Reopen changed Review → In Progress through the UI.

## Providers

Providers is the primary connection surface. It lists Claude Code, Codex, OpenCode, and other detected local harnesses, then OpenAI, Anthropic, and Groq. The web UI accurately explains that OS credential access is unavailable in a browser and routes connection to Desktop. Desktop reuses the existing secure credential flow; saved secrets are not displayed. Provider UI tests passed.

## Cancellation

Created DEV-10 (`01a10885-3a43-7ba0-984b-c6880baddb6e`) and started run `01a10885-d523-7069-be16-322c571e01e3` through the UI. Pressed Stop while it was Running and confirmed. The UI and server reported cancellation; the run ended with status **cancelled**, Codex process exited, no orphan process remained, and the issue stayed intact in Todo. No file change was reported.

## Browser smoke and cause of prior stall

The stall came from the development server cold-compiling routes under memory pressure and restarting during HMR. The old smoke also depended on seeded Review data and `networkidle`, which is unsuitable while realtime WebSocket traffic is active. The smoke now uses the normal login helper, visible route/content checks, real empty/new states, and no network-idle wait. Production-build smoke completed cleanly: **1 passed in 5.7s**.

## Validation

- `pnpm lint` — passed; existing hook warnings only
- `pnpm typecheck` — passed, 10 packages
- Focused Provider, route/title, and Review UI tests — passed
- Full views suite — 5,955 tests across 475 files passed
- Desktop suite — 666 tests passed
- Web suite — 279 tests passed
- `make test` — Go suite passed with race detector and migrated temporary database
- Web production build — passed
- Desktop production build — passed
- `git diff --check` — passed
- Secret-pattern scan — no credential patterns in source; known pattern matches are confined to test fixtures/examples

## Screenshots (1440×900)

- [Providers](providers.jpg)
- [Create Agent](create-agent.jpg)
- [Issues](issues.jpg)
- [New Issue](new-issue.jpg)
- [Assigned / Running](assigned-running.jpg)
- [Real completed Review](real-review.jpg)
- [Agents](agents.jpg)
- [FastPaths](fastpaths.jpg)
- [Inbox](inbox.jpg)
- [Settings](settings.jpg)

## Remaining blockers

None identified for the stated friendly-alpha acceptance criteria.
