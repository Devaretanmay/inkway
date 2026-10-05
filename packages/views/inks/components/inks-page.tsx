"use client";

import { useQuery } from "@tanstack/react-query";
import { BookOpenCheck, FlaskConical, LoaderCircle, Zap } from "lucide-react";
import { useWorkspaceId } from "@inkway/core/hooks";
import { inkFastPathsOptions } from "@inkway/core/ink/queries";
import { CollectionPageHeader } from "../../layout/collection-page";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@inkway/ui/components/ui/empty";
import { useT } from "../../i18n";
import type { InkFastPathSite } from "@inkway/core/types";

const LIFECYCLE_TONE: Record<InkFastPathSite["status"], string> = {
  OBSERVE: "border-border bg-muted text-muted-foreground",
  CANDIDATE: "border-warning/20 bg-warning/10 text-warning",
  SHADOW: "border-warning/20 bg-warning/10 text-warning",
  ACTIVE: "border-success/20 bg-success/10 text-success",
  DEMOTED: "border-destructive/20 bg-destructive/10 text-destructive",
  RETIRED: "border-border bg-muted text-muted-foreground",
};

const STAGES = [
  { key: "stage_learning", Icon: BookOpenCheck },
  { key: "stage_shadow", Icon: FlaskConical },
  { key: "stage_active", Icon: Zap },
] as const;

function lifecycleLabel(
  status: InkFastPathSite["status"],
  labels: { learning: string; candidate: string; shadow: string; active: string; demoted: string; retired: string },
) {
  switch (status) {
    case "OBSERVE":
    case "CANDIDATE":
      return status === "OBSERVE" ? labels.learning : labels.candidate;
    case "SHADOW": return labels.shadow;
    case "ACTIVE": return labels.active;
    case "DEMOTED": return labels.demoted;
    case "RETIRED": return labels.retired;
  }
}

function timestamp(value: string | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "—" : date.toLocaleString();
}

export default function InksPage() {
  const { t } = useT("layout");
  const workspaceId = useWorkspaceId();
  const { data, isPending, isError } = useQuery(inkFastPathsOptions(workspaceId ?? ""));
  const sites = data?.sites ?? [];
  const runtimes = data?.runtimes ?? [];

  return (
    <div className="flex h-full flex-col">
      <CollectionPageHeader
        icon={Zap}
        title={t(($) => $.fastpaths.title)}
        description={t(($) => $.fastpaths.subtitle)}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-6">
        <div className="mx-auto w-full max-w-4xl space-y-5">
          {isPending ? (
            <div className="flex items-center justify-center gap-2 py-16 text-caption text-muted-foreground" role="status">
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              {t(($) => $.fastpaths.loading)}
            </div>
          ) : isError ? (
            <Empty className="border-0">
              <EmptyHeader>
                <EmptyMedia variant="icon"><Zap aria-hidden="true" /></EmptyMedia>
                <EmptyTitle>{t(($) => $.fastpaths.load_error)}</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : sites.length === 0 ? (
            <Empty className="border-0">
              <EmptyHeader>
                <EmptyMedia variant="icon"><Zap aria-hidden="true" /></EmptyMedia>
                <EmptyTitle>{t(($) => $.fastpaths.empty_heading)}</EmptyTitle>
                <EmptyDescription>{t(($) => $.fastpaths.empty_body)}</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <ol className="w-full space-y-2 text-left">
                  {STAGES.map(({ key, Icon }, index) => (
                    <li key={key} className="flex gap-3 rounded-lg border-[0.5px] border-dashed border-surface-border px-3 py-2.5">
                      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-micro font-medium tabular-nums text-muted-foreground">{index + 1}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 text-body font-medium text-muted-foreground">
                          <Icon className="size-3.5 shrink-0" aria-hidden="true" />
                          {t(($) => $.fastpaths[key])}
                        </span>
                        <span className="mt-0.5 block text-caption leading-5 text-muted-foreground">
                          {t(($) => $.fastpaths[`${key}_detail` as "stage_learning_detail"])}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
                <p className="text-micro text-muted-foreground">{t(($) => $.fastpaths.stage_note)}</p>
              </EmptyContent>
            </Empty>
          ) : (
            sites.map((site) => (
              <article key={`${site.runtime_id}:${site.site_name}:${site.site_version}`} className="rounded-xl border border-surface-border bg-surface p-4 md:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-mono text-body font-semibold">{site.site_name}</h2>
                    <p className="mt-1 text-caption text-muted-foreground">{t(($) => $.fastpaths.runtime)} · {site.runtime_id}</p>
                  </div>
                  <span className={`rounded-full border px-2.5 py-1 text-caption font-medium ${LIFECYCLE_TONE[site.status]}`}>
                    {lifecycleLabel(site.status, {
                      learning: t(($) => $.fastpaths.stage_learning),
                      candidate: t(($) => $.fastpaths.candidate),
                      shadow: t(($) => $.fastpaths.stage_shadow),
                      active: t(($) => $.fastpaths.stage_active),
                      demoted: t(($) => $.fastpaths.demoted),
                      retired: t(($) => $.fastpaths.retired),
                    })}
                  </span>
                </div>
                <dl className="mt-5 grid grid-cols-2 gap-x-5 gap-y-4 md:grid-cols-3">
                  <Metric label={t(($) => $.fastpaths.observations)} value={site.observations.toLocaleString()} />
                  <Metric label={t(($) => $.fastpaths.verified_outcomes)} value={site.verified_outcomes.toLocaleString()} />
                  <Metric label={t(($) => $.fastpaths.fast_served)} value={site.fast_served.toLocaleString()} />
                  <Metric label={t(($) => $.fastpaths.coverage)} value={`${(site.coverage * 100).toFixed(1)}%`} />
                  <Metric label={t(($) => $.fastpaths.false_serves)} value={site.false_serves.toLocaleString()} />
                  {site.model_calls_avoided !== undefined && (
                    <Metric label={t(($) => $.fastpaths.model_calls_avoided)} value={site.model_calls_avoided.toLocaleString()} />
                  )}
                  <Metric label={t(($) => $.fastpaths.last_maintenance)} value={timestamp(site.last_maintenance)} />
                </dl>
                <details className="mt-4 border-t border-surface-border pt-3 text-micro text-muted-foreground">
                  <summary className="cursor-pointer">{t(($) => $.fastpaths.updated)} · {timestamp(site.updated_at)}</summary>
                  <p className="mt-2 break-all font-mono">{site.site_version}</p>
                </details>
              </article>
            ))
          )}
          {!isPending && !isError && runtimes.length > 0 && (
            <section aria-label={t(($) => $.fastpaths.runtime)} className="flex flex-wrap gap-2">
              {runtimes.map((runtime) => (
                <span key={runtime.runtime_id} className="rounded-full border border-surface-border px-2.5 py-1 text-micro text-muted-foreground">
                  {runtime.runtime_id} · {t(($) => $.fastpaths[runtime.status])}
                </span>
              ))}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="text-micro text-muted-foreground">{label}</dt><dd className="mt-1 truncate text-body font-medium tabular-nums">{value}</dd></div>;
}
