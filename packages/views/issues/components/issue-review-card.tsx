"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, MessageSquarePlus, Undo2 } from "lucide-react";
import { Button } from "@inkway/ui/components/ui/button";
import { api } from "@inkway/core/api";
import { issueKeys } from "@inkway/core/issues/queries";
import { runtimeListOptions, runtimeDisplayLabel } from "@inkway/core/runtimes";
import { useWorkspaceId } from "@inkway/core/hooks";
import { useActorName } from "@inkway/core/workspace/hooks";
import type { Issue, UpdateIssueRequest } from "@inkway/core/types";
import { Markdown } from "@inkway/ui/markdown";
import { IssueRunsDialog } from "./issue-runs-dialog";
import { commentRunOutput } from "./comment-runs";
import { AgentAvatarStack } from "../../agents/components/agent-avatar-stack";
import { useStatusLabel } from "./task-run-labels";
import { useT, useTimeAgo } from "../../i18n";

/**
 * The review hand-off, made explicit.
 *
 * Ink's loop ends with a human judging an agent's work. When the issue
 * sits in review, the only four questions that matter are: who did this, which
 * run produced it, what did the agent say it did, and what now. This card is
 * exactly those four — plus the two verdict buttons and a way back into the
 * conversation.
 *
 * It is deliberately not a diff viewer. The agent's own returned summary is the
 * deliverable a human reads first; the transcript, the per-run log and the code
 * it touched all stay one click away in the right panel and the runs dialog.
 *
 * Every transition routes through the caller's `onUpdate`, which is the issue
 * detail `updateField` action — the same path the status picker uses, including
 * the start-work confirmation gate. Nothing here writes the issue directly.
 */
export function IssueReviewCard({
  issue,
  onUpdate,
  onContinue,
}: {
  issue: Issue;
  onUpdate: (updates: Partial<UpdateIssueRequest>) => void;
  onContinue?: () => void;
}) {
  const { t } = useT("issues");
  const timeAgo = useTimeAgo();
  const { getActorName } = useActorName();
  const workspaceId = useWorkspaceId();
  const { data: runtimes = [] } = useQuery(runtimeListOptions(workspaceId));

  const { data: tasks = [] } = useQuery({
    queryKey: issueKeys.tasks(issue.id),
    queryFn: () => api.listTasksByIssue(issue.id),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  /**
   * The run whose result is being judged: the most recent completed run that
   * returned something. Falls back to the most recent completed run so an
   * agent that finished without a summary still gets named, rather than the
   * card implying nobody worked on it.
   */
  const run = useMemo(() => {
    return tasks.filter((task) => task.status === "completed" && task.kind !== "quick_create")
      .toSorted((a, b) => Date.parse(b.completed_at ?? b.created_at) - Date.parse(a.completed_at ?? a.created_at))[0] ?? null;
  }, [tasks]);

  const { data: comments = [] } = useQuery({
    queryKey: [...issueKeys.tasks(issue.id), "review-comments"],
    queryFn: () => api.listComments(issue.id),
    enabled: !!run,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const [detailsOpen, setDetailsOpen] = useState(false);
  const result = run ? commentRunOutput(run) : null;
  const agentName = run ? getActorName("agent", run.agent_id) : null;
  const finishedAt = run?.completed_at ?? null;
  const runStatusLabel = useStatusLabel(run?.status ?? "completed");
  const runtime = run ? runtimes.find((item) => item.id === run.runtime_id) : null;
  const providerTool = runtime
    ? runtimeDisplayLabel(runtime)
    : run?.usage?.find((usage) => usage.provider)?.provider ?? null;
  const model = run?.usage?.map((usage) => usage.model).filter(Boolean).join(", ") ?? "";
  const agentReport = run
    ? comments.find((comment) => comment.author_type === "agent" && comment.source_task_id === run.id)?.content ?? null
    : null;

  return (
    <section
      aria-label={t(($) => $.review.title)}
      className="mt-5 rounded-lg border-[0.5px] border-surface-border bg-surface px-3 py-2.5"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h2 className="text-label font-medium text-muted-foreground">
          {t(($) => $.review.title)}
        </h2>
        {run ? (
          <>
            <AgentAvatarStack agentIds={[run.agent_id]} size="xs" max={1} />
            <span className="min-w-0 truncate text-body font-medium">
              {agentName}
            </span>
            <span className="shrink-0 text-caption text-muted-foreground">
              {runStatusLabel}
              {finishedAt ? ` · ${timeAgo(finishedAt)}` : ""}
            </span>
          </>
        ) : null}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Button type="button" variant="outline" size="sm" onClick={() => setDetailsOpen(true)}>
            {t(($) => $.current_run.view_details)}{run ? ` · ${run.id.slice(0, 8)}` : ""}
          </Button>
          {onContinue ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-caption"
              onClick={onContinue}
            >
              <MessageSquarePlus className="size-3.5" aria-hidden="true" />
              {t(($) => $.review.continue)}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1 text-caption"
            onClick={() => onUpdate({ status: "in_progress" })}
          >
            <Undo2 className="size-3.5" aria-hidden="true" />
            {t(($) => $.review.reopen)}
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-7 gap-1 text-caption"
            onClick={() => onUpdate({ status: "done" })}
          >
            <Check className="size-3.5" aria-hidden="true" />
            {t(($) => $.review.accept)}
          </Button>
        </div>
      </div>

      <div className="mt-2 border-t border-surface-border pt-2">
        {run ? (
          <dl className="mb-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-caption">
            <dt className="text-muted-foreground">{t(($) => $.review.provider_tool)}</dt>
            <dd className="min-w-0 truncate">{providerTool ?? "Not reported"}{model ? ` · ${model}` : ""}</dd>
          </dl>
        ) : null}
        <p className="text-caption font-medium text-muted-foreground">
          {t(($) => $.review.result_label)}
        </p>
        {result ? (
          <p className="mt-1 line-clamp-6 whitespace-pre-wrap text-body">
            {result}
          </p>
        ) : (
          <p className="mt-1 text-body text-muted-foreground">
            {run
              ? t(($) => $.review.no_result)
              : t(($) => $.review.no_agent)}
          </p>
        )}
        {agentReport ? (
          <div className="mt-2 border-t border-surface-border pt-2">
            <p className="text-caption font-medium text-muted-foreground">{t(($) => $.review.agent_report)}</p>
            <Markdown className="mt-1 max-h-36 overflow-y-auto text-caption" mode="minimal">{agentReport}</Markdown>
          </div>
        ) : null}
      </div>
      <IssueRunsDialog open={detailsOpen} onOpenChange={setDetailsOpen} issueId={issue.id} identifier={issue.identifier} tasks={tasks} />
    </section>
  );
}
