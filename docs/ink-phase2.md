# Ink Phase 2 — product pass

Phase 1 gave the fork its visible identity and primary navigation. Phase 2
turns that shell into the Ink product experience: a Kanban control plane
where a human creates work, assigns it to an AI agent, watches it progress,
reviews the result, and only opens deeper execution information on demand.

This is a **UI pass over existing workflows**. No execution semantics change.

## Ground rules held throughout

- `Issue -> Agent -> Run -> Runtime -> tool -> results` is untouched.
- `IssueService.WillEnqueueRun` remains the single authority on whether a write
  starts a run. The client-side `runConfirmIntent` gate stays advisory and is
  never bypassed, removed, or "simplified away".
- Backlog parking, `suppress_run`, triage refusal, and the run/issue
  completion split are unchanged.
- Board columns still key on the concrete `issue.status`, never on the
  lifecycle category, so custom workspace statuses keep working.

## Reuse before replacement

Almost every affordance Phase 2 asks for already existed somewhere in the
tree. The work was wiring and framing, not reinvention:

| Need | Reused |
| --- | --- |
| 5-column board | `BoardView` + `visibleStatusKeys` + `hideStatus`/`showStatus` |
| Status tabs | view-store `statusFilters` / `toggleStatusFilter` |
| `Search issues…` | `IssueSurface`'s existing `search` prop (server-side `q`) |
| `+ New Issue` | `useIssueSurfaceActions().createIssue` |
| Agent + run state on cards | `IssueAgentActivityIndicator` (shared task snapshot) |
| Current run + Stop Run | `issueKeys.tasks`, existing cancel mutation |
| Read/unread + archive | inbox mutations, unchanged |
| Runtime/model selection | `RuntimePicker` / `ModelDropdown` |

## Surface-by-surface

### Issues — the primary home

- `INK_BOARD_STATUSES` (`backlog, todo, in_progress, in_review, done`)
  names the preferred permanent columns. `blocked` and `cancelled` join
  `DEFAULT_HIDDEN_STATUSES`, so the board opens at five columns. They are not
  deleted: the status filter submenu lists them, selecting one restores its
  column.
- New `IssuesStatusTabs`: `All | Backlog | Todo | In Progress | Review | Done`
  plus a "more statuses" dropdown carrying every other status, so a
  default-hidden status is never invisible.
- `IssuesPage` gains the product subtitle, a `Search issues…` field bound to
  the surface's existing server-side search, a `+ New Issue` button, and the
  status tab row. Saved views, scope tabs, filter chips, display controls,
  sort, and view switching stay exactly where they were.
- Board cards gain an explicit agent + run-state line (`agent name · ●
  Running` / `Queued` / `Needs review` / `Failed`) driven by the same run
  snapshot the header chip uses. No logs, prompts, token counts, or telemetry.

### Issue detail

Two new self-contained cards above the description:

- **Current Run** — rendered only while an agent is active. Agent, state,
  elapsed time, `[Stop Run]` and `[View run details]`. Reuses the existing
  task query and cancel mutation.
- **Review summary** — rendered when the issue is `in_review`. Selects latest
  completed run, names its agent, surfaces returned result and opens run history;
  offers accept (Done) / reopen (In Progress) / continue.

The existing right-panel execution log starts collapsed; runs dialog, transcript,
comments and timeline remain reachable. Raw run detail stays opt-in.

### Inbox

Reframed as the human attention queue. A subtitle states the contract, and a
category row (`All | Needs attention | Review | Updates`) classifies items
from **existing** fields only:

| Tab | Predicate |
| --- | --- |
| Needs attention | `severity === "action_required"` |
| Review | `review_requested`, plus `task_completed` / `agent_completed` only when linked issue status is `in_review` |
| Updates | everything else |

No backend event type is invented. The classifier is a pure function over
`InboxItemType`/`InboxSeverity`, so a future attention item (agent stalled,
cloud escalation, recovery-required) classifies itself with no Inbox redesign.

### Agents

- `AGENT_DEFAULT_HIDDEN_COLUMNS` now hides owner, access, last-active, runs and
  created, leaving `Name | Runtime | Model | Status`. All columns stay
  user-toggleable; the row model and queries are unchanged.
- The create form promotes Name, Description, Runtime, Model and Instructions.
  Thinking level, service tier, concurrency, skills, conversation starters and
  access move behind an `Advanced` disclosure. Runtime/model selection is the
  same components and the same `AgentDraft` state machine.

### FastPaths

Still unconnected. The page now explains the Learning -> Shadow -> Active
lifecycle and why each stage exists. No Ink API call, no request, no
fabricated count, accuracy, cost saving, serve rate, or latency figure.

### Settings

Navigation regrouped to the Ink contract (Account, Workspace, Issues &
workflow, Connections). Collaboration-heavy entries — chat channels, connected
apps, quick actions, members, billing — leave the **visible** navigation. Their
components, routes and URL resolution stay intact so deep links still resolve,
and the backend is untouched.

## Deliberately deferred

Tracked in [ink-product-debt.md](./ink-product-debt.md):
Ink Decision-JIT, the Python SDK, the FastPath backend, provider
onboarding and secret storage, usage analytics, agent traces, mobile, and the
Phase 4 settings architecture.