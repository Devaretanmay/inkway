// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  syncDaemonForLocalApp,
  type DaemonLocalSyncAPI,
} from "./daemon-local-sync";

const calls: string[] = [];

function makeApi(overrides: Partial<DaemonLocalSyncAPI> = {}): DaemonLocalSyncAPI {
  return {
    setTargetApiUrl: vi.fn(async () => {
      calls.push("setTargetApiUrl");
    }),
    syncToken: vi.fn(async () => {
      calls.push("syncToken");
    }),
    autoStart: vi.fn(async () => {
      calls.push("autoStart");
    }),
    ...overrides,
  };
}

beforeEach(() => {
  calls.length = 0;
  vi.clearAllMocks();
});

describe("syncDaemonForLocalApp", () => {
  // Regression: syncToken used to race a separate effect's setTargetApiUrl.
  // Arriving first meant main had no resolved profile and wrote the token to
  // the user's default CLI profile. #6399.
  it("pushes the target URL before syncing the token", async () => {
    const api = makeApi();
    await syncDaemonForLocalApp(api, "http://127.0.0.1:41555", "inkway_local_capability");

    expect(calls).toEqual(["setTargetApiUrl", "syncToken", "autoStart"]);
    expect(api.setTargetApiUrl).toHaveBeenCalledWith("http://127.0.0.1:41555");
    expect(api.syncToken).toHaveBeenCalledWith("inkway_local_capability");
  });

  it("awaits the target URL rather than firing it off", async () => {
    let released: (() => void) | undefined;
    const api = makeApi({
      setTargetApiUrl: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            released = () => {
              calls.push("setTargetApiUrl");
              resolve();
            };
          }),
      ),
    });

    const pending = syncDaemonForLocalApp(api, "http://127.0.0.1:41555", "inkway_local_capability");
    await Promise.resolve();
    expect(api.syncToken).not.toHaveBeenCalled();

    released?.();
    await pending;
    expect(calls).toEqual(["setTargetApiUrl", "syncToken", "autoStart"]);
  });

  it("does not start the daemon when the token sync fails", async () => {
    const api = makeApi({
      syncToken: vi.fn(async () => {
        throw new Error("daemon profile is not resolved yet");
      }),
    });

    await expect(
      syncDaemonForLocalApp(api, "http://127.0.0.1:41555", "inkway_local_capability"),
    ).rejects.toThrow(/not resolved/);
    expect(api.autoStart).not.toHaveBeenCalled();
  });
});
