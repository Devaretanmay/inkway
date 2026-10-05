import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  clearAllWorkspaceStorage,
  clearWorkspaceStorage,
} from "./storage-cleanup";
import {
  registerDraftCleanup,
  __clearDraftCleanupRegistryForTest,
} from "../drafts/cleanup-registry";

beforeEach(() => {
  __clearDraftCleanupRegistryForTest();
});

describe("clearWorkspaceStorage", () => {
  it("removes all non-draft workspace-scoped keys for the given slug", () => {
    const adapter = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };

    clearWorkspaceStorage(adapter, "ws_123");

    expect(adapter.removeItem).toHaveBeenCalledWith("inkway_issue_surface_views:ws_123");
    expect(adapter.removeItem).toHaveBeenCalledWith("inkway_issues_view:ws_123");
    expect(adapter.removeItem).toHaveBeenCalledWith("inkway_issues_scope:ws_123");
    expect(adapter.removeItem).toHaveBeenCalledWith("inkway_my_issues_view:ws_123");
    expect(adapter.removeItem).toHaveBeenCalledWith("inkway:chat:selectedAgentId:ws_123");
    expect(adapter.removeItem).toHaveBeenCalledWith("inkway:chat:selectedProjectId:ws_123");
    expect(adapter.removeItem).toHaveBeenCalledWith("inkway:chat:activeSessionId:ws_123");
    expect(adapter.removeItem).toHaveBeenCalledWith("inkway:chat:expanded:ws_123");
    expect(adapter.removeItem).toHaveBeenCalledWith("inkway_navigation:ws_123");
    // 8 non-draft keys, and no registered drafts in this test.
    expect(adapter.removeItem).toHaveBeenCalledTimes(9);
  });

  it("also clears registered draft keys via the registry", () => {
    const adapter = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    registerDraftCleanup({
      storageKey: "inkway_test_draft",
      workspaceScoped: true,
      resetInMemory: vi.fn(),
    });
    registerDraftCleanup({
      storageKey: "inkway_test_global_draft",
      workspaceScoped: false,
      resetInMemory: vi.fn(),
    });

    clearWorkspaceStorage(adapter, "ws_123");

    expect(adapter.removeItem).toHaveBeenCalledWith("inkway_test_draft:ws_123");
    // Globally-namespaced draft keys are removed without the slug suffix.
    expect(adapter.removeItem).toHaveBeenCalledWith("inkway_test_global_draft");
    // 8 non-draft keys + 2 registered draft keys.
    expect(adapter.removeItem).toHaveBeenCalledTimes(11);
  });
});

describe("clearAllWorkspaceStorage", () => {
  function makeAdapter(values: Record<string, string>) {
    return {
      getItem: (k: string) => values[k] ?? null,
      setItem: (k: string, v: string) => {
        values[k] = v;
      },
      removeItem: (k: string) => {
        delete values[k];
      },
      keys: () => Object.keys(values),
      snapshot: () => ({ ...values }),
    };
  }

  // The point of enumerating: a cold start rejected at the identity probe
  // never loaded a workspace list, so it cannot name a single slug.
  it("removes workspace-scoped keys for slugs the caller never knew", () => {
    registerDraftCleanup({
      storageKey: "inkway_comment_drafts",
      workspaceScoped: true,
      resetInMemory: vi.fn(),
    });
    registerDraftCleanup({
      storageKey: "inkway_quick_create",
      workspaceScoped: false,
      resetInMemory: vi.fn(),
    });
    const adapter = makeAdapter({
      "inkway_comment_drafts:acme": "1",
      "inkway_comment_drafts:globex": "2",
      "inkway_navigation:initech": "3",
      "inkway:chat:activeSessionId:acme": "4",
      inkway_quick_create: "5",
      // Not session state — a device preference and another app's key.
      inkway_locale: "zh-Hans",
      unrelated_key: "keep",
    });

    expect(clearAllWorkspaceStorage(adapter)).toBe(true);

    expect(adapter.snapshot()).toEqual({
      inkway_locale: "zh-Hans",
      unrelated_key: "keep",
    });
  });

  it("reports when the adapter cannot enumerate, instead of silently doing nothing", () => {
    const adapter = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };

    expect(clearAllWorkspaceStorage(adapter)).toBe(false);
    expect(adapter.removeItem).not.toHaveBeenCalled();
  });
});
