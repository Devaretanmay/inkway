import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { runtimeId, runtimes } = vi.hoisted(() => ({
  runtimeId: "550e8400-e29b-41d4-a716-446655440000",
  runtimes: [
    { id: "550e8400-e29b-41d4-a716-446655440000", daemon_id: "local-daemon", name: "Codex", provider: "codex", status: "online" },
    { id: "550e8400-e29b-41d4-a716-446655440001", daemon_id: "remote-daemon", name: "Remote Claude", provider: "claude", status: "online" },
  ],
}));
vi.mock("@inkway/core/hooks", () => ({ useWorkspaceId: () => "workspace-1" }));
vi.mock("@inkway/core/runtimes/queries", () => ({ runtimeListOptions: () => ({ queryKey: ["runtime-list"] }) }));
vi.mock("@inkway/core/runtimes", () => ({ runtimeDisplayName: (runtime: { name: string }) => runtime.name }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: runtimes }),
}));
import { ProviderSettingsTab } from "./provider-settings-tab";

describe("ProviderSettingsTab", () => {
  const providerCredential = vi.fn();

  beforeEach(() => {
    providerCredential.mockReset();
    providerCredential.mockImplementation(async (request: { action: string }) => ({
      ok: true,
      message: request.action === "set" ? "Credential stored in the OS credential store." : "Credential status checked.",
      ...(request.action === "status" ? { present: false } : {}),
    }));
    Object.defineProperty(window, "daemonAPI", { configurable: true, value: { providerCredential } });
  });

  it("sends the credential to the local helper and clears the form after save", async () => {
    render(<ProviderSettingsTab localDaemonId="local-daemon" />);
    expect(screen.getByLabelText("Connected tool")).toHaveValue(runtimeId);
    expect(screen.getByLabelText("Connected tool").querySelectorAll("option")).toHaveLength(2);
    fireEvent.click(screen.getByRole("heading", { name: "Groq" }).closest("article")!.querySelector("button")!);
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "local-only-test-value" } });
    fireEvent.click(screen.getByRole("button", { name: "Save connection" }));

    await waitFor(() => expect(providerCredential).toHaveBeenCalledWith({
      action: "set",
      runtimeId,
      provider: "groq",
      model: "openai/gpt-oss-120b",
      value: "local-only-test-value",
    }));
    await waitFor(() => expect(screen.queryByLabelText("API key")).not.toBeInTheDocument());
    expect(await screen.findByRole("status")).toHaveTextContent("OS credential store");
  });

  it("checks status only against the local daemon and shows unconfigured providers", async () => {
    render(<ProviderSettingsTab localDaemonId="local-daemon" />);
    await waitFor(() => expect(providerCredential).toHaveBeenCalledTimes(3));
    expect(providerCredential.mock.calls.map(([request]) => request)).toEqual(expect.arrayContaining([
      { action: "status", runtimeId, provider: "openai" },
      { action: "status", runtimeId, provider: "anthropic" },
      { action: "status", runtimeId, provider: "groq" },
    ]));
    expect(screen.getAllByText("Not connected")).toHaveLength(3);
    expect(screen.queryByText("Remote Claude")).not.toBeInTheDocument();
  });
});
