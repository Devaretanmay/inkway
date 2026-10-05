import type { InboxItem } from "../types";

/**
 * Inbox attention categories.
 *
 * The Inbox is not a feed — it is the queue of things a human may need to act
 * on. These buckets classify items using fields the backend already computes,
 * and nothing else:
 *
 * - `severity` is set server-side at insert time and is the backend's own
 *   judgement that an item needs a person (`action_required`) versus being
 *   merely interesting (`attention`, `info`).
 * - `review_requested`, `task_completed` and `agent_completed` are the existing
 *   review hand-off events.
 * - everything else is an update: mentions, comments, assignment and status
 *   changes. Those are worth reading but are not a decision.
 *
 * No backend event type is invented to fill a tab, and none is removed. The
 * classifier is a total function over the item, so an attention item added
 * later — a stalled agent, a cloud escalation, a FastPath lifecycle change —
 * classifies itself by its `severity` without this page changing shape.
 *
 * Deliberately order-independent and mutually exclusive: `action_required`
 * wins over review, review wins over updates. An item never appears twice.
 */

export type InboxAttentionCategory = "all" | "attention" | "review" | "updates";

/** Existing notification types that mean "a human should judge this work". */
const REVIEW_TYPES: ReadonlySet<string> = new Set([
  "review_requested",
  "task_completed",
  "agent_completed",
]);

export const INBOX_ATTENTION_CATEGORIES: readonly InboxAttentionCategory[] = [
  "all",
  "attention",
  "review",
  "updates",
];

export function inboxAttentionCategory(
  item: { type: string; severity: InboxItem["severity"]; issue_status?: InboxItem["issue_status"] },
): Exclude<InboxAttentionCategory, "all"> {
  if (item.severity === "action_required") return "attention";
  if (item.type === "review_requested" || (REVIEW_TYPES.has(item.type) && item.issue_status === "in_review")) return "review";
  return "updates";
}

export function filterInboxByAttentionCategory<T extends InboxItem>(
  items: readonly T[],
  category: InboxAttentionCategory,
): T[] {
  if (category === "all") return items as T[];
  return items.filter((item) => inboxAttentionCategory(item) === category);
}

/** Count per category, for the tab badges. `all` is the input length. */
export function inboxAttentionCounts(
  items: readonly InboxItem[],
): Record<InboxAttentionCategory, number> {
  const counts: Record<InboxAttentionCategory, number> = {
    all: items.length,
    attention: 0,
    review: 0,
    updates: 0,
  };
  for (const item of items) counts[inboxAttentionCategory(item)] += 1;
  return counts;
}