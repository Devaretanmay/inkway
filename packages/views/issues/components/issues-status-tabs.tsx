"use client";

import { useMemo } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@inkway/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@inkway/ui/components/ui/dropdown-menu";
import { cn } from "@inkway/ui/lib/utils";
import type { IssueStatus } from "@inkway/core/types";
import { INK_BOARD_STATUSES } from "@inkway/core/issues/stores/view-store";
import { useViewStore, useViewStoreApi } from "@inkway/core/issues/stores/view-store-context";
import { useWorkspaceId } from "@inkway/core/hooks";
import { useStatusOptions } from "../utils/status-options";
import { StatusIcon } from "./status-icon";
import { useT } from "../../i18n";

/**
 * The Ink status tab row: `All | Backlog | Todo | In Progress | Review |
 * Done`, plus a dropdown for every other status the workspace knows about.
 *
 * This is a lens over the board, not a second source of truth. Each tab is
 * the existing `statusFilters` field, so the board columns, the filter chips,
 * the saved views and the server query all move together — nothing here can
 * disagree with what the board renders.
 *
 * The dropdown exists because the board opens at five columns while the status
 * model still carries `blocked`, `cancelled` and whatever custom statuses a
 * workspace defines. Those are hidden by display preference, not deleted, so
 * this row is where they stay reachable — each option shows its live issue
 * count, and selecting one both filters to it and restores its column.
 */
export function IssuesStatusTabs() {
  const { t } = useT("issues");
  const wsId = useWorkspaceId();
  const statusOptions = useStatusOptions(wsId);
  const statusFilters = useViewStore((s) => s.statusFilters);
  const toggleStatusFilter = useViewStore((s) => s.toggleStatusFilter);
  const showStatus = useViewStore((s) => s.showStatus);
  const viewStore = useViewStoreApi();

  const byKey = useMemo(
    () => new Map(statusOptions.map((option) => [option.key, option])),
    [statusOptions],
  );

  // Every option the workspace offers, minus the five that already occupy a
  // permanent column. A custom status the workspace added shows up here
  // automatically — it needs no Ink-side registration to stay findable.
  const overflowOptions = statusOptions.filter(
    (option) => !INK_BOARD_STATUSES.includes(option.key),
  );

  const activeKey = statusFilters.length === 1 ? statusFilters[0] : null;
  // Tab semantics: exactly one lens at a time, or none. Writing the array
  // directly rather than toggling keeps repeated clicks on the active tab from
  // accumulating a multi-status filter that reads as "All".
  const selectStatus = (key: IssueStatus | null) => {
    if (key) showStatus(key);
    viewStore.setState({ statusFilters: key ? [key] : [] });
  };

  const tabClass = (active: boolean) =>
    cn(
      "h-7 shrink-0 gap-1.5 px-2.5 text-caption",
      active
        ? "bg-accent text-accent-foreground hover:bg-accent/80"
        : "text-muted-foreground",
    );

  return (
    <div className="-webkit-overflow-scrolling-touch flex min-w-0 items-center gap-1 overflow-x-auto">
      <Button
        variant="outline"
        size="sm"
        className={tabClass(statusFilters.length === 0)}
        onClick={() => selectStatus(null)}
        aria-pressed={statusFilters.length === 0}
      >
        <span className="truncate">{t(($) => $.status_tabs.all)}</span>
      </Button>

      {INK_BOARD_STATUSES.map((key) => {
        const option = byKey.get(key);
        if (!option) return null;
        const active = activeKey === key;
        return (
          <Button
            key={key}
            variant="outline"
            size="sm"
            className={tabClass(active)}
            onClick={() => selectStatus(key)}
            aria-pressed={active}
          >
            <StatusIcon
              status={key}
              color={option.color}
              icon={option.icon}
              category={option.category}
              className="size-3.5 shrink-0"
            />
            <span className="truncate">{option.label}</span>
          </Button>
        );
      })}

      {overflowOptions.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="outline"
                size="sm"
                className={cn(tabClass(false), "shrink-0 px-1.5")}
                aria-label={t(($) => $.status_tabs.more)}
              >
                <ChevronDown className="size-3.5" />
              </Button>
            }
          />
          <DropdownMenuContent align="start" className="w-auto min-w-56">
            <DropdownMenuLabel className="text-caption font-normal text-muted-foreground">
              {t(($) => $.status_tabs.hidden_hint)}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {overflowOptions.map((option) => {
              return (
                <DropdownMenuCheckboxItem
                  key={option.key}
                  checked={statusFilters.includes(option.key)}
                  onCheckedChange={() => {
                    // Restoring the column is what makes a hidden status
                    // visible on the board; the filter alone would narrow the
                    // board to a column that display preferences keep hidden.
                    showStatus(option.key);
                    toggleStatusFilter(option.key);
                  }}
                >
                  <StatusIcon
                    status={option.key}
                    color={option.color}
                    icon={option.icon}
                    category={option.category}
                    className="size-3.5 shrink-0"
                  />
                  <span className="truncate">{option.label}</span>
                </DropdownMenuCheckboxItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}