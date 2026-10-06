import { beforeEach, describe, expect, it, vi } from "vitest";

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: toastError } }));

import { reauthenticateDaemon } from "./daemon-reauth";
import type { DaemonTranslator } from "../components/daemon-i18n";

const translations = {
  desktop: {
    daemon: {
      reconnect_failed: "Cannot reconnect local runtime",
      try_again_moment: "Try again shortly.",
      try_again: "Try again.",
    },
  },
};
const t = ((selector: (resources: typeof translations) => string) =>
  selector(translations)) as DaemonTranslator;
const daemonAPI = { reauthenticate: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  (window as unknown as { daemonAPI: typeof daemonAPI }).daemonAPI = daemonAPI;
});

describe("reauthenticateDaemon", () => {
  it("restarts the local runtime with the current installation capability", async () => {
    localStorage.setItem("inkway_token", "local-capability");
    daemonAPI.reauthenticate.mockResolvedValue({ ok: true });

    await reauthenticateDaemon(t);

    expect(daemonAPI.reauthenticate).toHaveBeenCalledWith("local-capability");
    expect(toastError).not.toHaveBeenCalled();
  });

  it("shows a retryable error when local runtime recovery fails", async () => {
    localStorage.setItem("inkway_token", "local-capability");
    daemonAPI.reauthenticate.mockResolvedValue({
      ok: false,
      reason: "transient",
      message: "local backend is unavailable",
    });

    await reauthenticateDaemon(t);

    expect(toastError).toHaveBeenCalledWith("Cannot reconnect local runtime", {
      description: "local backend is unavailable",
    });
  });

  it("does not send a credential when no local capability exists", async () => {
    await reauthenticateDaemon(t);

    expect(daemonAPI.reauthenticate).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith("Cannot reconnect local runtime");
  });
});
