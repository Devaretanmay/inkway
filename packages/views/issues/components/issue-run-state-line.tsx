"use client";

import { memo, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { agentTaskSnapshotOptions } from "@inkway/core/agents";
import { useWorkspaceId } from "@inkway/core/hooks";
import { useActorName } from "@inkway/core/workspace/hooks";
import type { AgentTask, Issue } from "@inkway/core/types";
import { cn } from "@inkway/ui/lib/utils";
import { useT } from "../../i18n";

/**
 * The board card's execution line: who is working on this issue, and what
 * state that work is in. One row, four honest states, no telemetry.
 *
 * Everything here comes from data Inkway already owns:
 *
 *   Running      an active task on this issue          (task snapshot)
 *   Queued       an active task waiting for a runtime  (task snapshot)
 *   Failed       the assignee's latest run failed      (task snapshot)
 *   Needs review the issue is parked for a human       (issue status)
 *
 * The workspace agent-task snapshot already returns every active task plus each
 * agent's most recent completed/failed run, so all four states resolve off one
 * shared query — the same one `IssueAgentActivityIndicator` subscribes to. That
 * matters on a board: a per-card history fetch would put one request behind
 * every card on screen.
 *
 * What is deliberately absent: transcripts, token counts, model output, cost,
 * and anything FastPath-shaped. Those live behind issue detail, and the board
 * only answers "is this moving, and who is moving it".
 */
export const IssueRunStateLine = memo(function IssueRunStateLine({
  issue,
}: {
  issue: Issue;
}) {
  const { t } = useT("issues");
  const wsId = useWorkspaceId();
  const { getActorName } = useActorName();

  const select = useCallback(
    (snapshot: AgentTask[]) => {
      const mine = snapshot.filter((task) => task.issue_id === issue.id).toSorted((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
      let running = false;
      let queued = false;
      let failed = false;
      for (const task of mine) {
        if (task.status === "running") running = true;
        else if (
          task.status === "queued" ||
          task.status === "dispatched" ||
          task.status === "waiting_local_directory"
        ) {
          queued = true;
        } else if (task.status === "failed") {
          failed = true;
        }
      }
      // One immutable triple per issue. React Query's structural sharing keeps
      // it referentially stable while this issue's tasks are unchanged, so a
      // workspace-wide snapshot refresh only re-renders the cards that moved.
      const active = mine.find((task) => task.status === "running") ?? mine.find((task) => ["queued", "dispatched", "waiting_local_directory"].includes(task.status));
      return { running, queued, failed: failed && mine[0]?.status === "failed", agentId: active?.agent_id ?? mine[0]?.agent_id };
    },
    [issue.id],
  );

  const { data: state } = useQuery({
    ...agentTaskSnapshotOptions(wsId),
    select,
  });

  const hasAgent = issue.assignee_type === "agent" && !!issue.assignee_id;
  const agentName =
    state?.agentId
      ? getActorName("agent", state.agentId)
      : issue.assignee_type && issue.assignee_id
      ? getActorName(issue.assignee_type, issue.assignee_id)
      : null;

  // Active work always outranks an outcome the run left behind: a run that
  // failed and was retried is Running now, not Failed.
  const tone = useMemo(() => {
    if (state?.running) {
      return { dot: "bg-success", label: t(($) => $.run_state.running) };
    }
    if (state?.queued) {
      return { dot: "bg-muted-foreground", label: t(($) => $.run_state.queued) };
    }
    if (state?.failed) {
      return { dot: "bg-destructive", label: t(($) => $.run_state.failed) };
    }
    if (hasAgent && issue.status === "in_review") {
      return {
        dot: "bg-warning",
        label: t(($) => $.run_state.needs_review),
      };
    }
    return null;
  }, [hasAgent, issue, state, t]);

  // Nothing running, nothing that failed, nothing waiting on a human: the card
  // is plain unstarted work and needs no execution line.
  if (!tone) return null;

  return (
    <span className="mt-1.5 flex min-w-0 items-center gap-1.5 text-caption">
      <span className={cn("size-1.5 shrink-0 rounded-full", tone.dot)} />
      {agentName ? (
        <span className="min-w-0 truncate text-foreground">{agentName}</span>
      ) : null}
      <span className={cn("shrink-0", agentName ? "text-muted-foreground" : "text-foreground")}>
        {tone.label}
      </span>
    </span>
  );
});