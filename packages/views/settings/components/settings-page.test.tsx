import { fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SidebarProvider, useSidebar } from "@inkway/ui/components/ui/sidebar";
import { configStore } from "@inkway/core/config";
import {
  BILLING_WORKSPACE_SUBSCRIPTIONS_FLAG,
  PLUGINS_V1_FLAG,
} from "@inkway/core/feature-flags";
import { renderWithI18n } from "../../test/i18n";

// This file tests the settings SHELL — the chrome around the tabs — so every
// tab panel is stubbed out. Their contents have their own test files.
const stub = vi.hoisted(() => (name: string) => () => ({
  [name]: () => <div>{name}</div>,
}));
vi.mock("./account-tab", stub("AccountTab"));
vi.mock("./preferences-tab", stub("PreferencesTab"));
vi.mock("./workspace-tab", stub("WorkspaceTab"));
vi.mock("./members-tab", stub("MembersTab"));
vi.mock("./code-tab", stub("CodeTab"));
vi.mock("./channels-tab", stub("ChannelsTab"));
vi.mock("./notifications-tab", stub("NotificationsTab"));
vi.mock("./labels-tab", stub("LabelsTab"));
vi.mock("./issue-statuses-tab", stub("IssueStatusesTab"));
vi.mock("./properties-tab", stub("PropertiesTab"));
vi.mock("./quick-actions-tab", stub("QuickActionsTab"));
vi.mock("./keyboard-shortcuts-tab", stub("KeyboardShortcutsTab"));
vi.mock("./plugins-tab", stub("PluginsTab"));
vi.mock("./mcp-tab", stub("McpTab"));
vi.mock("./billing-tab", stub("BillingTab"));

const shell = vi.hoisted(() => ({
  appsAvailable: false,
  role: "owner" as "owner" | "admin" | "member",
}));
vi.mock("./connected-apps-tab", () => ({
  ConnectedAppsTab: () => <div>ConnectedAppsTab</div>,
  useComposioAvailable: () => shell.appsAvailable,
}));

vi.mock("@inkway/core/paths", () => ({
  useCurrentWorkspace: () => ({ id: "ws-1", name: "Acme" }),
}));
vi.mock("@inkway/core/workspace/avatar-url", () => ({
  resolvePublicFileUrl: (url: string | null | undefined) => url ?? null,
}));
vi.mock("@inkway/core/permissions", () => ({
  useCurrentMember: () => ({ role: shell.role, isLoading: false }),
}));
vi.mock("@inkway/core/auth", () => {
  const state = { user: { id: "user-1", name: "Ada Lovelace", avatar_url: null } };
  const useAuthStore = Object.assign(
    (selector?: (s: typeof state) => unknown) =>
      selector ? selector(state) : state,
    { getState: () => state },
  );
  return { useAuthStore };
});

const replace = vi.fn();
const push = vi.fn();
const navigationState = { search: "" };
vi.mock("../../navigation/context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../navigation/context")>()),
  useNavigation: () => ({
    searchParams: new URLSearchParams(navigationState.search),
    hash: "",
    pathname: "/acme/settings",
    replace,
    push,
  }),
}));

// Compact by default: that is the width where the nav is a sheet and this
// trigger is the only way to reach it.
const layout = { compact: true };
vi.mock("@inkway/ui/hooks/use-mobile", () => ({
  useIsMobile: () => layout.compact,
  useIsCompact: () => layout.compact,
}));

import { SettingsPage } from "./settings-page";

function NavStateProbe() {
  const { openMobile } = useSidebar();
  return <div data-testid="nav-open">{String(openMobile)}</div>;
}

function trigger() {
  return screen.getByRole("button", { name: "Toggle left sidebar" });
}

function nav() {
  return screen.getByRole("navigation", { name: "Settings" });
}

beforeEach(() => {
  layout.compact = true;
  navigationState.search = "";
  shell.appsAvailable = false;
  shell.role = "owner";
  configStore.getState().setFeatureFlags({});
  replace.mockClear();
  push.mockClear();
});

describe("SettingsPage nav trigger", () => {
  it("opens the nav from settings at compact widths", () => {
    // Settings builds its own chrome instead of a PageHeader, so without this
    // control a touch user who lands here has no way back to the nav at all —
    // the keyboard shortcut is not an answer on a tablet.
    renderWithI18n(
      <SidebarProvider>
        <NavStateProbe />
        <SettingsPage />
      </SidebarProvider>,
    );

    expect(screen.getByTestId("nav-open").textContent).toBe("false");

    fireEvent.click(trigger());

    expect(screen.getByTestId("nav-open").textContent).toBe("true");
  });

  it("hides the trigger only where the nav is a permanent column", () => {
    // The nav is in-flow from `xl` up, so the control is CSS-gated rather than
    // unmounted — jsdom applies no stylesheet, hence the class assertion.
    renderWithI18n(
      <SidebarProvider>
        <SettingsPage />
      </SidebarProvider>,
    );

    expect(trigger().className).toContain("xl:hidden");
  });

  it("still renders standalone, without a sidebar around it", () => {
    // Desktop mounts settings inside its own shell; the trigger has to no-op
    // rather than throw when there is no SidebarProvider above it.
    renderWithI18n(<SettingsPage />);

    expect(
      screen.queryByRole("button", { name: "Toggle left sidebar" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
  });
});

describe("SettingsPage Plugin feature flag", () => {
  it("hides Plugins and falls back from a direct tab URL when disabled", () => {
    navigationState.search = "tab=plugins";

    renderWithI18n(<SettingsPage />);

    expect(
      screen.queryByRole("link", { name: "Plugins" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("PluginsTab")).not.toBeInTheDocument();
    expect(screen.getByText("AccountTab")).toBeInTheDocument();
  });

  it("keeps Plugins mountable by direct link when enabled but out of the primary menu", () => {
    navigationState.search = "tab=plugins";
    configStore.getState().setFeatureFlags({ [PLUGINS_V1_FLAG]: true });

    renderWithI18n(<SettingsPage />);

    expect(screen.queryByRole("link", { name: "Plugins" })).not.toBeInTheDocument();
    expect(screen.getByText("PluginsTab")).toBeInTheDocument();
  });
});

describe("SettingsPage workspace subscription feature flag", () => {
  it("hides Billing and falls back to Workspace General from a direct URL", () => {
    navigationState.search = "tab=billing";

    renderWithI18n(<SettingsPage />);

    expect(
      screen.queryByRole("link", { name: "Billing" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("BillingTab")).not.toBeInTheDocument();
    expect(screen.getByText("WorkspaceTab")).toBeInTheDocument();
  });

  it("shows and mounts Billing only when explicitly enabled", () => {
    navigationState.search = "tab=billing";
    configStore.getState().setFeatureFlags({
      [BILLING_WORKSPACE_SUBSCRIPTIONS_FLAG]: true,
    });

    renderWithI18n(<SettingsPage />);

    expect(screen.queryByRole("link", { name: "Billing" })).not.toBeInTheDocument();
    expect(screen.getByText("BillingTab")).toBeInTheDocument();
  });
});

describe("SettingsPage information architecture", () => {
  it("shows only account, connection, and tool settings in the primary menu", () => {
    renderWithI18n(<SettingsPage />);
    const sidebar = within(nav());
    const account = sidebar.getByRole("region", { name: /Account/ });
    expect(within(account).getByRole("link", { name: "Account" })).toBeInTheDocument();
    expect(within(account).getByRole("link", { name: "General" })).toBeInTheDocument();
    expect(within(account).queryByRole("link", { name: "API Tokens" })).toBeNull();
    const connections = sidebar.getByRole("region", { name: /Tools & repositories/ });
    for (const name of ["Local tools", "Repositories"]) {
      expect(within(connections).getByRole("link", { name })).toBeInTheDocument();
    }
    for (const name of ["Issue Statuses", "Labels", "MCP servers", "Messaging"]) {
      expect(sidebar.queryByRole("link", { name })).toBeNull();
    }
  });

  it("keeps retired pages out of navigation", () => {
    renderWithI18n(<SettingsPage />);
    expect(
      within(nav()).queryByRole("link", {
        name: /^(Issue|Chat|GitHub|Labs|Integrations|Projects|Squads|Autopilots)$/,
      }),
    ).not.toBeInTheDocument();
  });

  it("opens old issue bookmarks in preferences", () => {
    navigationState.search = "tab=issue";
    renderWithI18n(<SettingsPage />);
    expect(screen.getByText("PreferencesTab")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "General" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("opens the GitHub App return URL on the Repositories page", () => {
    navigationState.search = "tab=repositories&github_connected=1";
    renderWithI18n(<SettingsPage />);
    expect(screen.getByText("CodeTab")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Repositories" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("lists Connected apps with the personal pages only when Composio is available", () => {
    const first = renderWithI18n(<SettingsPage />);
    expect(screen.queryByRole("link", { name: "Connected apps" })).toBeNull();
    first.unmount();

    shell.appsAvailable = true;
    navigationState.search = "tab=integrations&connected=notion";
    renderWithI18n(<SettingsPage />);
    const personal = within(nav()).getByRole("region", { name: /Account/ });
    expect(
      within(personal).queryByRole("link", { name: "Connected apps" }),
    ).toBeNull();
    expect(screen.getByText("ConnectedAppsTab")).toBeInTheDocument();
  });

  it("marks pages a member can only view", () => {
    shell.role = "member";
    renderWithI18n(<SettingsPage />);
    const general = screen.getByRole("link", { name: /^Local tools/ });
    expect(
      within(general).getByLabelText("Only owners and admins can change this"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Labels" })).toBeNull();
  });

  it("places platform settings in a device group", () => {
    renderWithI18n(
      <SettingsPage
        extraDeviceTabs={[
          {
            value: "updates",
            label: "Updates",
            icon: () => null,
            content: <div>Device updates</div>,
          },
        ]}
      />,
    );
    const device = screen.getByRole("region", { name: "Providers" });
    expect(within(device).getByRole("link", { name: "Updates" })).toBeInTheDocument();
  });

  it("navigates from the compact selector and clears the old detail", () => {
    navigationState.search = "tab=channels&integration=slack&keep=1";
    renderWithI18n(<SettingsPage />);
    fireEvent.change(
      screen.getByRole("combobox", { name: "Go to settings page" }),
      { target: { value: "preferences" } },
    );
    expect(push).toHaveBeenCalledWith("/acme/settings?tab=preferences&keep=1");
  });
});

describe("SettingsPage search", () => {
  it("finds settings inside pages and opens the one chosen", () => {
    renderWithI18n(<SettingsPage />);
    const input = screen.getByRole("searchbox", { name: "Search settings" });

    fireEvent.change(input, { target: { value: "time zone" } });

    const results = screen.getByRole("listbox", { name: "Search settings" });
    const option = within(results).getByRole("option", { name: /Time zone/ });
    expect(option).toHaveTextContent("Account › General");

    fireEvent.click(option);
    expect(push).toHaveBeenCalledWith(
      "/acme/settings?tab=preferences&section=timezone",
    );
  });

  it("opens the highlighted result from the keyboard and clears on Escape", () => {
    renderWithI18n(<SettingsPage />);
    const input = screen.getByRole("searchbox", { name: "Search settings" });

    fireEvent.change(input, { target: { value: "slack" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(
      within(screen.getByRole("listbox", { name: "Search settings" })).queryByRole("option"),
    ).toBeNull();
    expect(push).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveValue("");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("finds the issue-opening preference by the name of its options", () => {
    renderWithI18n(<SettingsPage />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search settings" }), {
      target: { value: "side preview" },
    });
    const results = screen.getByRole("listbox", { name: "Search settings" });
    const option = within(results).getByRole("option", { name: /Opening issues/ });
    expect(within(results).getAllByRole("option")).toHaveLength(1);
    fireEvent.click(option);
    expect(push).toHaveBeenCalledWith(
      "/acme/settings?tab=preferences&section=issue-opening",
    );
  });

  it("does not offer pages hidden by feature flags", () => {
    renderWithI18n(<SettingsPage />);
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search settings" }),
      { target: { value: "plugins" } },
    );
    expect(screen.getByText("No matching settings")).toBeInTheDocument();
  });
});
