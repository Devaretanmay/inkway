"use client";

import { useState } from "react";
import { ListTodo, Plus, Search, X } from "lucide-react";
import { Button } from "@inkway/ui/components/ui/button";
import { Input } from "@inkway/ui/components/ui/input";
import type {
  Issue,
  IssueTableFacetSpec,
  IssueTableFacetsResponse,
  WorkingAgentSummary,
} from "@inkway/core/types";
import { useIssuesScope } from "@inkway/core/issues/stores/issues-scope-store";
import { useViewStore } from "@inkway/core/issues/stores/view-store-context";
import { PageHeader, PAGE_GUTTER } from "../../layout/page-header";
import { RefreshablePageIcon } from "../../layout/refreshable-page-icon";
import { useT } from "../../i18n";
import { IssueSurface } from "../surface/issue-surface";
import { useIssueSurfaceActionsOptional } from "../surface/actions-context";
import { IssuesHeader } from "./issues-header";
import { IssuesStatusTabs } from "./issues-status-tabs";

/**
 * Board search. The surface already owns a server-side `q` window for every
 * mode (`IssueSurface`'s `search` prop, wired into `IssueTableQuerySpec.search`
 * and debounced), so this field drives that window rather than filtering
 * whatever happens to be loaded — a client-side filter would silently hide
 * matches living on a later page.
 */
function IssuesSearchField({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const { t } = useT("issues");
  return (
    <div className="relative min-w-0 flex-1 sm:max-w-xs">
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t(($) => $.page.search_placeholder)}
        aria-label={t(($) => $.page.search_placeholder)}
        className="h-8 pl-8 pr-7 text-body"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label={t(($) => $.page.search_placeholder)}
          className="absolute right-1.5 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

function IssuesSurfaceHeader({
  issues,
  workingAgents,
  isRefreshing,
  facetCountsExact,
  tableFacetCounts,
  onTableFacetChange,
  search,
  onSearchChange,
}: {
  issues: Issue[];
  workingAgents: WorkingAgentSummary[] | undefined;
  isRefreshing: boolean;
  facetCountsExact: boolean;
  tableFacetCounts?: IssueTableFacetsResponse;
  onTableFacetChange: (facet: IssueTableFacetSpec | null) => void;
  search: string;
  onSearchChange: (next: string) => void;
}) {
  const { t } = useT("issues");
  const dateFilter = useViewStore((s) => s.dateFilter);
  const setDateFilter = useViewStore((s) => s.setDateFilter);
  const surfaceActions = useIssueSurfaceActionsOptional();

  return (
    <>
      <PageHeader>
        <RefreshablePageIcon refreshing={isRefreshing}>
          <ListTodo className="size-4" />
        </RefreshablePageIcon>
        <h1 className="text-body font-medium">{t(($) => $.page.breadcrumb_title)}</h1>
        <p className="ml-1 hidden min-w-0 truncate text-caption text-muted-foreground lg:block">
          {t(($) => $.page.subtitle)}
        </p>
        <div className="ml-auto flex min-w-0 items-center gap-2">
          <IssuesSearchField value={search} onChange={onSearchChange} />
          <Button
            type="button"
            size="sm"
            className="h-8 shrink-0 gap-1"
            onClick={() => surfaceActions?.createIssue()}
          >
            <Plus className="size-3.5" aria-hidden="true" />
            <span className="hidden md:inline">
              {t(($) => $.page.new_issue)}
            </span>
          </Button>
        </div>
      </PageHeader>
      <div
        className={`flex shrink-0 items-center gap-2 py-1.5 ${PAGE_GUTTER}`}
      >
        <IssuesStatusTabs />
      </div>
      <IssuesHeader
        scopedIssues={issues}
        workingAgents={workingAgents}
        dateFilter={dateFilter}
        onDateFilterChange={setDateFilter}
        facetCountsExact={facetCountsExact}
        tableFacetCounts={tableFacetCounts}
        onTableFacetChange={onTableFacetChange}
      />
    </>
  );
}

export function IssuesPage() {
  const { t } = useT("issues");
  const scope = useIssuesScope("issues");
  const [search, setSearch] = useState("");

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <IssueSurface
        scope={{ type: "workspace", actorKind: scope }}
        modes={["board", "list", "table", "swimlane"]}
        search={search}
        batchToolbar="list"
        renderHeader={({ controller }) => (
          <IssuesSurfaceHeader
            issues={controller.surfaceIssues}
            workingAgents={controller.workingAgents}
            isRefreshing={controller.isRefreshing}
            facetCountsExact={controller.facetCountsExact}
            tableFacetCounts={controller.tableFacetCounts}
            onTableFacetChange={controller.setActiveTableFacet}
            search={search}
            onSearchChange={setSearch}
          />
        )}
        renderEmpty={() => (
          <div className="flex flex-1 min-h-0 flex-col items-center justify-center gap-2 text-muted-foreground">
            <ListTodo className="h-10 w-10 text-faint-foreground" />
            <p className="text-body">{t(($) => $.page.empty_title)}</p>
          </div>
        )}
      />
    </div>
  );
}