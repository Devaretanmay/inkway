// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { screen } from "@testing-library/react";
import type { InkFastPathsResponse } from "@inkway/core/types";
import { renderWithI18n } from "../../test/i18n";
import InksPage from "./inks-page";

const { listFastPaths } = vi.hoisted(() => ({ listFastPaths: vi.fn() }));
vi.mock("@inkway/core/ink/queries", () => ({
  inkFastPathsOptions: () => ({ queryKey: ["fastpaths-test"], queryFn: listFastPaths, enabled: true }),
}));
vi.mock("@inkway/core/hooks", () => ({ useWorkspaceId: () => "workspace-1" }));
afterEach(() => { listFastPaths.mockReset(); vi.restoreAllMocks(); });

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithI18n(
    <QueryClientProvider client={client}><InksPage /></QueryClientProvider>,
  );
}

describe("InksPage", () => {
  it("keeps explanatory empty state when runtime reports no sites", async () => {
    listFastPaths.mockResolvedValueOnce({ runtimes: [], sites: [] });
    const { container } = renderPage();
    expect(await screen.findByText("No Inks yet")).toBeTruthy();
    expect(screen.getByText(/Inkway verifies them against real outcomes/)).toBeTruthy();
    for (const stage of ["Learning", "Shadow", "Active"]) expect(screen.getByText(stage)).toBeTruthy();
    expect(container.querySelector("table")).toBeNull();
  });

  it("shows real lifecycle, runtime, and aggregate data without inventing savings", async () => {
    const data: InkFastPathsResponse = {
      runtimes: [{ runtime_id: "runtime-1", status: "unavailable" }],
      sites: [
        { runtime_id: "runtime-1", site_name: "coding_agent.recovery_action", site_version: "a".repeat(64), status: "OBSERVE", observations: 10, verified_outcomes: 7, fast_served: 0, coverage: 0, false_serves: 0, updated_at: "2026-10-04T00:00:00Z" },
        { runtime_id: "runtime-2", site_name: "coding_agent.recovery_action", site_version: "b".repeat(64), status: "SHADOW", observations: 20, verified_outcomes: 18, fast_served: 2, coverage: 0.1, false_serves: 0, updated_at: "2026-10-04T00:00:00Z" },
        { runtime_id: "runtime-3", site_name: "coding_agent.recovery_action", site_version: "c".repeat(64), status: "ACTIVE", observations: 30, verified_outcomes: 29, fast_served: 9, coverage: 0.3, false_serves: 0, updated_at: "2026-10-04T00:00:00Z", model_calls_avoided: 9, savings_basis: "declared_and_validated_fixed_call_count" },
      ],
    };
    listFastPaths.mockResolvedValueOnce(data);
    renderPage();
    expect((await screen.findAllByText("coding_agent.recovery_action")).length).toBe(3);
    expect(screen.getAllByText("Learning").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Shadow").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
    expect(screen.getByText(/runtime-1 · unavailable/i)).toBeTruthy();
    for (const coverage of ["0.0%", "10.0%", "30.0%"]) expect(screen.getByText(coverage)).toBeTruthy();
    expect(screen.getAllByText("9", { selector: "dd" })).toHaveLength(2);
  });

  it("shows an error state when the telemetry endpoint fails", async () => {
    listFastPaths.mockRejectedValueOnce(new Error("offline"));
    renderPage();
    expect(await screen.findByText("Ink data could not be loaded.")).toBeTruthy();
  });
});
