import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AgentTask, Issue } from "@inkway/core/types";
import { renderWithI18n } from "../../test/i18n";
import { IssueCurrentRunCard } from "./issue-current-run-card";
import { IssueReviewCard } from "./issue-review-card";

const { listTasks, listComments, listRuntimes, cancelTask } = vi.hoisted(() => ({ listTasks: vi.fn(), listComments: vi.fn(), listRuntimes: vi.fn(), cancelTask: vi.fn() }));
vi.mock("@inkway/core/api", () => ({ api: { listTasksByIssue: listTasks, listComments, listRuntimes, cancelTask } }));
vi.mock("@inkway/core/hooks", () => ({ useWorkspaceId: () => "workspace" }));
vi.mock("@inkway/core/workspace/hooks", () => ({ useActorName: () => ({ getActorName: (_: string, id: string) => id }) }));
vi.mock("../../agents/components/agent-avatar-stack", () => ({ AgentAvatarStack: () => null }));
vi.mock("./issue-runs-dialog", () => ({ IssueRunsDialog: ({ open, identifier }: { open: boolean; identifier: string }) => open ? <div>Run history {identifier}</div> : null }));

function task(id: string, status: AgentTask["status"], extra: Partial<AgentTask> = {}): AgentTask {
  return { id, status, agent_id: `${id}-agent`, runtime_id: "runtime", issue_id: "issue", priority: 0,
    created_at: "2026-10-03T10:00:00Z", started_at: null, dispatched_at: null, completed_at: null, result: null, error: null, ...extra };
}
function render(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return renderWithI18n(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}
beforeEach(() => {
  cleanup(); vi.clearAllMocks(); cancelTask.mockResolvedValue({}); listComments.mockResolvedValue([]);
  listRuntimes.mockResolvedValue([{ id: "runtime", name: "Codex (Mac)", custom_name: "", provider: "codex" }]);
});

describe("issue work summaries", () => {
  it("names and cancels the running task when another task is queued", async () => {
    listTasks.mockResolvedValue([task("queue", "queued"), task("active", "running")]);
    render(<IssueCurrentRunCard issueId="issue" identifier="MIC-1" />);
    await screen.findByText("active-agent");
    fireEvent.click(screen.getByRole("button", { name: "Stop work" }));
    await waitFor(() => expect(cancelTask).toHaveBeenCalledWith("issue", "active"));
  });
  it("shows cancellation errors and keeps the retry action", async () => {
    listTasks.mockResolvedValue([task("active", "running")]);
    cancelTask.mockRejectedValue(new Error("Runtime disconnected"));
    render(<IssueCurrentRunCard issueId="issue" identifier="MIC-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Stop work" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Runtime disconnected");
    expect(screen.getByRole("button", { name: "Stop work" })).toBeEnabled();
  });
  it("does not present an older summary as the latest completed run", async () => {
    listTasks.mockResolvedValue([
      task("old", "completed", { completed_at: "2026-10-03T11:00:00Z", result: { comment: "Old result" } }),
      task("new", "completed", { completed_at: "2026-10-03T12:00:00Z" }),
    ]);
    const onUpdate = vi.fn();
    render(<IssueReviewCard issue={{ id: "issue", identifier: "MIC-1" } as Issue} onUpdate={onUpdate} />);
    await screen.findByText("new-agent");
    expect(screen.queryByText("Old result")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /View details/ }));
    expect(screen.getByText("Run history MIC-1")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(onUpdate).toHaveBeenCalledWith({ status: "done" });
  });

  it("shows the real provider and task-linked agent report in Review", async () => {
    listTasks.mockResolvedValue([task("new", "completed", { result: { output: "Created `alpha-proof.txt`." }, usage: [{ provider: "codex", model: "gpt-5.5", input_tokens: 1, output_tokens: 1, cache_read_tokens: 0, cache_write_tokens: 0 }] })]);
    listComments.mockResolvedValue([{
      id: "report", issue_id: "issue", author_type: "agent", author_id: "new-agent", source_task_id: "new",
      content: "Changed files: `alpha-proof.txt`\n\nTests run: none.", type: "comment", parent_id: null,
      reactions: [], attachments: [], created_at: "2026-10-03T12:00:00Z", updated_at: "2026-10-03T12:00:00Z",
      resolved_at: null, resolved_by_type: null, resolved_by_id: null,
    }]);
    render(<IssueReviewCard issue={{ id: "issue", identifier: "MIC-1" } as Issue} onUpdate={vi.fn()} />);
    expect(await screen.findByText("Codex (Mac) · gpt-5.5")).toBeVisible();
    expect(await screen.findByText("Agent report")).toBeVisible();
    expect(screen.getByText("alpha-proof.txt")).toBeVisible();
    expect(screen.getByText("Tests run: none.")).toBeVisible();
  });
});
