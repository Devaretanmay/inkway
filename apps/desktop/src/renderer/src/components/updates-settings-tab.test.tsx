import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const translations = {
  desktop: {
    updates: {
      title: "Updates",
      current_version: "Current version",
      check_section_title: "Check for updates",
      check_section_description: "Check manually",
      up_to_date: "Up to date",
      downloading: "Downloading v{{version}}",
      check_now: "Check now",
      checking: "Checking",
    },
  },
};

const checkForUpdates = vi.fn();
vi.mock("@inkway/views/i18n", () => ({
  useT: () => ({
    t: (selector: (resources: typeof translations) => string, values?: Record<string, string>) =>
      Object.entries(values ?? {}).reduce(
        (text, [key, value]) => text.replace(`{{${key}}}`, value),
        selector(translations),
      ),
  }),
}));

import { UpdatesSettingsTab } from "./updates-settings-tab";

describe("UpdatesSettingsTab", () => {
  beforeEach(() => {
    checkForUpdates.mockReset().mockResolvedValue({
      ok: true,
      currentVersion: "1.2.3",
      latestVersion: "1.2.3",
      available: false,
    });
    Object.defineProperty(window, "desktopAPI", {
      configurable: true,
      value: { appInfo: { version: "1.2.3" } },
    });
    Object.defineProperty(window, "updater", {
      configurable: true,
      value: { checkForUpdates },
    });
  });

  it("offers explicit manual checks and no automatic update switch", async () => {
    render(<UpdatesSettingsTab />);
    expect(screen.queryByRole("switch")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Check now" }));
    expect(checkForUpdates).toHaveBeenCalledOnce();
  });
});
