import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "@inkway/core/i18n/react";
import type { Agent, AgentRuntime, Issue, Workspace } from "@inkway/core/types";
import enOnboarding from "../locales/en/onboarding.json";

const TEST_RESOURCES = { en: { onboarding: enOnboarding } };

const mocks = vi.hoisted(() => ({
  listRuntimes: vi.fn(),
  listProjects: vi.fn(),
  createAgent: vi.fn(),
  createIssue: vi.fn(),
  completeOnboarding: vi.fn(),
  onComplete: vi.fn(),
}));

vi.mock("@inkway/core/api", () => ({ api: {
  listRuntimes: mocks.listRuntimes,
  listProjects: mocks.listProjects,
  createAgent: mocks.createAgent,
  createIssue: mocks.createIssue,
} }));
vi.mock("@inkway/core/workspace", () => ({
  useCreateWorkspace: () => ({ mutateAsync: vi.fn() }),
  useWorkspaceList: () => ({
    workspaces: [{ id: "ws-1", name: "Alpha", slug: "alpha" }],
    ready: true,
    refetch: vi.fn(),
  }),
}));
vi.mock("@inkway/core/auth", () => ({
  useAuthStore: (selector: (state: { user: { id: string; name: string } }) => unknown) =>
    selector({ user: { id: "member-1", name: "Taylor" } }),
}));
vi.mock("@inkway/core/onboarding", () => ({
  completeOnboarding: mocks.completeOnboarding,
}));
vi.mock("../platform/local-directory", () => ({
  pickDirectory: vi.fn(),
  validateLocalDirectory: vi.fn(),
}));

import { InkwayFirstRun } from "./inkway-first-run";

function renderFirstRun() {
  return render(
    <I18nProvider locale="en" resources={TEST_RESOURCES}>
      <InkwayFirstRun onComplete={mocks.onComplete} />
    </I18nProvider>,
  );
}

const workspace = { id: "ws-1", name: "Alpha", slug: "alpha" } as Workspace;
const runtime = {
  id: "runtime-1", name: "Codex", provider: "codex", status: "online", daemon_id: "daemon-1",
} as AgentRuntime;
const agent = { id: "agent-1", name: "My coding agent" } as Agent;
const issue = { id: "issue-1", title: "First task" } as Issue;

describe("Inkway first-run onboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listRuntimes.mockResolvedValue([runtime]);
    mocks.listProjects.mockResolvedValue({ projects: [] });
    mocks.createAgent.mockResolvedValue(agent);
    mocks.createIssue.mockResolvedValue(issue);
    mocks.completeOnboarding.mockResolvedValue(undefined);
    mocks.onComplete.mockReset();
    Object.defineProperty(window, "daemonAPI", {
      configurable: true,
      value: { getStatus: vi.fn().mockResolvedValue({ state: "running", deviceName: "Test Mac" }) },
    });
  });

  it("creates a CLI agent and first issue without requiring an API key or questionnaire", async () => {
    renderFirstRun();

    await waitFor(() => expect(mocks.listRuntimes).toHaveBeenCalledWith({ workspace_id: "ws-1" }, "alpha"));
    expect(screen.getByRole("heading", { name: "Welcome to Inkway" })).toBeInTheDocument();
    expect(screen.queryByText(/Mika|questionnaire|tell us about you/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByText(/Local coding tools need no API key/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    fireEvent.click(screen.getByRole("button", { name: "Create agent" }));
    await waitFor(() => expect(mocks.createAgent).toHaveBeenCalled());
    expect(mocks.createAgent).toHaveBeenCalledWith(expect.objectContaining({
      name: "My coding agent", runtime_id: runtime.id,
    }), "alpha");
    expect(mocks.createAgent.mock.calls[0]?.[0]).not.toHaveProperty("runtime_config");

    await waitFor(() => expect(mocks.listProjects).toHaveBeenCalledWith(undefined, "alpha"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.change(screen.getByLabelText("Issue title"), { target: { value: "First task" } });
    fireEvent.click(screen.getByRole("button", { name: "Create & Run" }));

    await waitFor(() => expect(mocks.createIssue).toHaveBeenCalledWith(expect.objectContaining({
      title: "First task", assignee_type: "agent", assignee_id: agent.id,
    }), "alpha"));
    expect(mocks.completeOnboarding).toHaveBeenCalledWith("full", workspace.id);
    expect(mocks.onComplete).toHaveBeenCalledWith(workspace, { kind: "issue", issueId: issue.id });
  });

  it("explains that a local CLI needs no provider key and gates Native agents on a verified provider", async () => {
    renderFirstRun();
    await waitFor(() => expect(mocks.listRuntimes).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByLabelText("API key (saved locally)")).toHaveAttribute("type", "password");
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    expect(screen.getByLabelText(/API provider/)).toBeDisabled();
    expect(screen.getByLabelText("Local tool")).toBeEnabled();
  });
});
