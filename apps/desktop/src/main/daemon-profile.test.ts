// @vitest-environment node
import { homedir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_HEALTH_PORT,
  deriveProfileName,
  healthPortForProfile,
  profileArgs,
  profileConfigPath,
  profileDir,
  profileLogPath,
  profilePidPath,
  profileUserIdPath,
} from "./daemon-profile";

const INKWAY_DIR = join(homedir(), ".inkway");
const DEFAULT_CLI_CONFIG = join(INKWAY_DIR, "config.json");

describe("deriveProfileName", () => {
  it("names the profile after the target host", () => {
    expect(deriveProfileName("https://api.example.test")).toBe(
      "desktop-api.example.test",
    );
  });

  it("uses one stable profile for the app-owned loopback server across launches", () => {
    expect(deriveProfileName("http://127.0.0.1:41001")).toBe("desktop-local-inkway");
    expect(deriveProfileName("http://127.0.0.1:50993")).toBe("desktop-local-inkway");
    expect(deriveProfileName("http://localhost:41001")).toBe("desktop-local-inkway");
  });

  it("does not create a new profile for each app-owned backend port", () => {
    expect(deriveProfileName("http://localhost:8080")).toBe("desktop-local-inkway");
  });

  it("names isolated development profiles without colliding with the user's CLI profile", () => {
    expect(deriveProfileName("http://127.0.0.1:41001", "local-proof")).toBe(
      "desktop-local-local-proof",
    );
  });

  it("falls back to a fixed name on an unparseable URL", () => {
    expect(deriveProfileName("not a url")).toBe("desktop");
  });
});

describe("profile paths", () => {
  it("always resolves under profiles/<name>", () => {
    const dir = join(INKWAY_DIR, "profiles", "desktop-api.example.test");
    expect(profileDir("desktop-api.example.test")).toBe(dir);
    expect(profileConfigPath("desktop-api.example.test")).toBe(
      join(dir, "config.json"),
    );
    expect(profileLogPath("desktop-api.example.test")).toBe(
      join(dir, "daemon.log"),
    );
    expect(profilePidPath("desktop-api.example.test")).toBe(
      join(dir, "daemon.pid"),
    );
    expect(profileUserIdPath("desktop-api.example.test")).toBe(
      join(dir, ".desktop-user-id"),
    );
  });

  // Regression: an unresolved profile used to resolve to ~/.inkway, so Desktop
  // could overwrite server_url and token in the user's own CLI config. #6399.
  it("refuses to build a path for an unresolved profile", () => {
    expect(() => profileDir("")).toThrow(/unresolved/);
    expect(() => profileConfigPath("")).toThrow(/unresolved/);
    expect(() => profileLogPath("")).toThrow(/unresolved/);
    expect(() => profilePidPath("")).toThrow(/unresolved/);
    expect(() => profileUserIdPath("")).toThrow(/unresolved/);
  });

  it("never yields the default CLI config path for any input", () => {
    for (const name of ["desktop-api.example.test", "desktop-local", "desktop", "x"]) {
      expect(profileConfigPath(name)).not.toBe(DEFAULT_CLI_CONFIG);
    }
    expect(() => profileConfigPath("")).toThrow();
  });
});

describe("profileArgs", () => {
  it("selects the Desktop-owned profile", () => {
    expect(profileArgs("desktop-api.example.test")).toEqual([
      "--profile",
      "desktop-api.example.test",
    ]);
  });

  // Regression: this returned [] for an unresolved profile, so the bundled CLI
  // ran against the user's default profile instead of Desktop's. #6399.
  it("refuses to spawn the CLI without a profile flag", () => {
    expect(() => profileArgs("")).toThrow(/unresolved/);
  });
});

describe("healthPortForProfile", () => {
  // Regression: this returned 19514 — the default profile's port — for an
  // unresolved profile, so Desktop would probe the user's own CLI daemon and
  // report it as its own. #6399.
  it("refuses to hand out a port for an unresolved profile", () => {
    expect(() => healthPortForProfile("")).toThrow(/unresolved/);
  });

  it("never derives the default profile's port", () => {
    for (const name of ["desktop-api.example.test", "desktop-local", "desktop", "x", "a".repeat(50)]) {
      expect(healthPortForProfile(name)).not.toBe(DEFAULT_HEALTH_PORT);
    }
  });

  it("derives a stable per-profile port above the default", () => {
    const port = healthPortForProfile("desktop-api.example.test");
    expect(port).toBeGreaterThan(DEFAULT_HEALTH_PORT);
    expect(port).toBe(healthPortForProfile("desktop-api.example.test"));
  });
});
