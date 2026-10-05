# Ink Phase 1 audit and Phase 2 completion plan

Inspected existing uncommitted fork changes before editing. They included both
Phase 1 shell changes and partial Phase 2 components. Existing changes were preserved.

## Existing boundaries and reuse

- Web: `apps/web/app`; desktop: `apps/desktop/src/renderer/src/routes.tsx`.
- Shared views: `packages/views`; API/state: `packages/core`; primitives: `packages/ui`.
- Navigation: `layout/app-sidebar.tsx`, shared paths and route icons.
- Issues: `issues/components/issues-page.tsx`, `board-card.tsx`, `issue-detail.tsx`,
  `issues/surface/issue-surface.tsx`; creation and assignment retain existing
  actions and run-confirmation flows.
- Inbox: `inbox/components/inbox-page.tsx`; existing read/archive mutations.
- Agents: existing list and `agents/create/agent-configuration-panel.tsx`, with
  runtime/model components reused in the shared configuration form.
- Settings: existing settings page and panels; runtime route remains mounted.
- Runs: existing task queries, cancel mutation, execution log and runs dialog.
- Backend: issue service enqueue decisions, handler persistence, run queue,
  daemon claiming and provider invocation remain outside this UI change.

## Phase 1 audit outcome

The Phase 1 product shell is present: primary navigation and FastPaths route exist
in both platforms, and Issues defaults to Kanban. This pass closed several visible
leaks in locale copy, onboarding, desktop display metadata, and the root landing
route. The old application identity remains in explicit legacy marketing routes,
Electron's upgrade-sensitive app/user-data/protocol identity, internal package and
database names, and old icon artwork; see `ink-branding-debt.md`.

Phase 1 is sufficient to proceed because the remaining items are recorded legacy
or compatibility debt, not a blocker to the Ink workflow. Phase 2 UI changes
and browser validation are complete. Typecheck, production build, and backend run
validation still have environment or baseline failures recorded in the completion
report.

## Phase 2 completed work

1. Closed visible shell branding gaps without renaming protocols or storage.
2. Corrected Inbox classifications using real event semantics.
3. Aligned current-run identity/status/cancellation; review summary selects latest
   completed execution and links to run history.
4. Kept execution details opt-in; preserved issue updates and confirmation gates.
5. Validated browser journeys at 1440x900 and 1280x800, desktop tests/typecheck,
   web build, shared-view typecheck and focused UI tests. Full backend and frontend
   suites have documented environment/baseline failures; assignment enqueue remains
   unverified because handler fixtures lack the `workspace` table.

No backend deletion, schema changes, provider changes or Ink core integration.
