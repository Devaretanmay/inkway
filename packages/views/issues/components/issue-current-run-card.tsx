"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CircleStop, ListTree, Loader2 } from "lucide-react";
import { Button } from "@inkway/ui/components/ui/button";
import { api } from "@inkway/core/api";
import { issueKeys } from "@inkway/core/issues/queries";
import { useCancelIssueRun } from "@inkway/core/issues/mutations";
import { useActorName } from "@inkway/core/workspace/hooks";
import { AgentAvatarStack } from "../../agents/components/agent-avatar-stack";
import { compareActiveIssueTasks } from "./active-task-order";
import { IssueRunsDialog } from "./issue-runs-dialog";
import { useStatusLabel } from "./task-run-labels";
import { useT, useTimeAgo } from "../../i18n";
import type { AgentTask } from "@inkway/core/types";

const ACTIVE_STATUSES: readonly AgentTask["status"][] = [
  "running",
  "queued",
  "dispatched",
  "waiting_local_directory",
];

/**
 * The one execution surface issue detail leads with.
 *
 * Ink's product loop is "assign, watch, review". When an agent is
 * working, the human's only real question is "is it alive and how do I stop
 * it" — so this card answers exactly that in the content column, above the
 * description, without making raw run detail the default screen.
 *
 * Execution depth stays one click away in both directions: `View run details`
 * opens the existing runs dialog, and the right-panel execution log keeps the
 * full transcript, per-run spend, retry and cancellation affordances it
 * already had. Nothing here replaces those; it fronts them.
 *
 * The task list is the same `issueKeys.tasks(issueId)` entry the header chip
 * and the execution log read, so all three agree on what is active without a
 * second request.
 */
export function IssueCurrentRunCard({ issueId, identifier }: { issueId: string; identifier: string }) {
  const { t } = useT("issues");
  const timeAgo = useTimeAgo();
  const { getActorName } = useActorName();
  const [stopping, setStopping] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const cancelRun = useCancelIssueRun(issueId);

  const { data: tasks = [] } = useQuery({
    queryKey: issueKeys.tasks(issueId),
    queryFn: () => api.listTasksByIssue(issueId),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const active = useMemo(
    () =>
      tasks
        .toSorted(compareActiveIssueTasks)
        .filter((task) => ACTIVE_STATUSES.includes(task.status)),
    [tasks],
  );

  const agentIds = useMemo(
    () => [...new Set(active.map((task) => task.agent_id))],
    [active],
  );
  const anyRunning = active.some((task) => task.status === "running");
  const current = active[0] ?? null;
  const startedAt = current?.started_at ?? current?.dispatched_at ?? current?.created_at ?? null;
  const agentName = current?.agent_id
    ? getActorName("agent", current.agent_id)
    : null;

  const statusLabel = useStatusLabel(current?.status ?? "running");

  // Nothing in flight: the card has no reason to exist. This is the difference
  // between a human-facing control plane and a monitoring dashboard.
  if (active.length === 0 || !current) return null;

  const stop = async () => {
    // Stopping is a real cancellation against the run queue. Only one run is
    // cancelled per click — a board where two agents are running should not
    // lose both to a single impatient press.
    if (stopping || !current) return;
    setStopping(true);
    try {
      await cancelRun.mutateAsync(current.id);
    } catch {
      // The mutation exposes its error below; keep the run and retry action visible.
    } finally {
      setStopping(false);
    }
  };

  return (
    <section
      aria-label={t(($) => $.current_run.title)}
      className="mt-5 rounded-lg border-[0.5px] border-surface-border bg-surface px-3 py-2.5"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h2 className="text-label font-medium text-muted-foreground">
          {t(($) => $.current_run.title)}
        </h2>
        <AgentAvatarStack agentIds={agentIds} size="xs" opacity={anyRunning ? "full" : "half"} max={3} />
        <span className="min-w-0 truncate text-body font-medium">
          {agentName ?? t(($) => $.agent_activity.unknown_hover)}
        </span>
        <span
          className={
            anyRunning
              ? "shrink-0 text-caption font-medium text-success"
              : "shrink-0 text-caption text-muted-foreground"
          }
        >
          {statusLabel}
        </span>
        {startedAt ? (
          <span className="shrink-0 text-caption text-muted-foreground">
            {t(($) => $.current_run.started_ago, { time: timeAgo(startedAt) })}
          </span>
        ) : null}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1 text-caption"
            onClick={() => setDetailsOpen(true)}
          >
            <ListTree className="size-3.5" aria-hidden="true" />
            {t(($) => $.current_run.view_details)}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-caption text-destructive"
            onClick={() => void stop()}
            disabled={stopping || cancelRun.isPending}
          >
            {stopping ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <CircleStop className="size-3.5" aria-hidden="true" />
            )}
            {t(($) => $.current_run.stop)}
          </Button>
        </div>
      </div>
      {cancelRun.error && <p role="alert" className="mt-2 text-caption text-destructive">{cancelRun.error.message}</p>}
      {/* Same dialog the execution log's "all runs" header opens, driven from
          here so the deep view is one click from the compact card. Controlled
          `open`, so it costs nothing while closed. */}
      <IssueRunsDialog
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        issueId={issueId}
        identifier={identifier}
        tasks={tasks}
      />
    </section>
  );
}