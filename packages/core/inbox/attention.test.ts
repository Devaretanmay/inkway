// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { InboxItem } from "../types";
import {
  filterInboxByAttentionCategory,
  inboxAttentionCategory,
  inboxAttentionCounts,
} from "./attention";

function item(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: "n1",
    workspace_id: "w1",
    recipient_type: "member",
    recipient_id: "u1",
    actor_type: "agent",
    actor_id: "a1",
    type: "new_comment",
    severity: "info",
    issue_id: "i1",
    title: "t",
    body: null,
    issue_status: "in_review",
    read: false,
    archived: false,
    created_at: "2026-01-01T00:00:00Z",
    details: null,
    ...overrides,
  } as InboxItem;
}

describe("inbox attention categories", () => {
  it("routes server-marked action_required items to attention", () => {
    expect(
      inboxAttentionCategory(item({ severity: "action_required", type: "new_comment" })),
    ).toBe("attention");
  });

  it("keeps a review hand-off in review even when it is only attention severity", () => {
    expect(inboxAttentionCategory(item({ type: "review_requested", severity: "info" }))).toBe(
      "review",
    );
    expect(inboxAttentionCategory(item({ type: "task_completed", severity: "attention" }))).toBe(
      "review",
    );
    expect(inboxAttentionCategory(item({ type: "agent_completed", severity: "info" }))).toBe(
      "review",
    );
  });

  it("does not confuse run completion with review", () => {
    expect(inboxAttentionCategory(item({ type: "task_completed", issue_status: "in_progress" }))).toBe("updates");
    expect(inboxAttentionCategory(item({ type: "agent_completed", issue_status: "done" }))).toBe("updates");
  });

  it("treats mentions, comments and field changes as updates", () => {
    for (const type of [
      "mentioned",
      "new_comment",
      "issue_assigned",
      "assignee_changed",
      "status_changed",
      "unassigned",
    ] as const) {
      expect(inboxAttentionCategory(item({ type }))).toBe("updates");
    }
  });

  it("lets action_required win over review so an item never lands in two tabs", () => {
    expect(
      inboxAttentionCategory(item({ type: "review_requested", severity: "action_required" })),
    ).toBe("attention");
  });

  it("classifies an unknown future type by severity rather than dropping it", () => {
    // A Ink-era attention item (agent stalled, escalation, recovery
    // required) must classify itself with no change to this module.
    expect(
      inboxAttentionCategory(
        { type: "unknown_event", severity: "action_required" },
      ),
    ).toBe("attention");
    expect(inboxAttentionCategory({ type: "unknown_event", severity: "info" })).toBe(
      "updates",
    );
  });

  it("partitions the list with no item lost or duplicated", () => {
    const items = [
      item({ id: "1", type: "task_failed", severity: "action_required" }),
      item({ id: "2", type: "task_completed", severity: "info" }),
      item({ id: "3", type: "mentioned", severity: "attention" }),
      item({ id: "4", type: "status_changed", severity: "info" }),
    ];
    const counts = inboxAttentionCounts(items);
    expect(counts.all).toBe(4);
    expect(counts.attention).toBe(1);
    expect(counts.review).toBe(1);
    expect(counts.updates).toBe(2);
    const union = [
      ...filterInboxByAttentionCategory(items, "attention"),
      ...filterInboxByAttentionCategory(items, "review"),
      ...filterInboxByAttentionCategory(items, "updates"),
    ].map((entry) => entry.id);
    expect(union.toSorted()).toEqual(["1", "2", "3", "4"]);
  });

  it("returns the input untouched for the all category", () => {
    const items = [item({ id: "1" })];
    expect(filterInboxByAttentionCategory(items, "all")).toBe(items);
  });
});