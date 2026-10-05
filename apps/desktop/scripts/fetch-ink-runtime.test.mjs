import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertSafeArchiveEntries, validateInkPin } from "./fetch-ink-runtime.mjs";

const pin = {
  artifact_version: "0.6.0rc2.1",
  ink_engine_version: "0.6.0rc2",
  model_version: "1.0.0",
  model_identifier: "ink-decision-v1",
  bridge_protocol_version: 1,
  platform: "darwin",
  architecture: "arm64",
  model_sha256: "a".repeat(64),
  url: "https://github.com/Devaretanmay/ink/releases/download/ink-runtime-v0.6.0rc2.1/ink-runtime-0.6.0rc2.1-darwin-arm64.zip",
  sha256: "b".repeat(64),
};

describe("Ink release pin", () => {
  it("keeps the checked-in Inkway dependency pinned to a versioned artifact and checksum", () => {
    const path = join(dirname(fileURLToPath(import.meta.url)), "ink-runtime.json");
    const checkedInPin = JSON.parse(readFileSync(path, "utf8"));
    expect(validateInkPin(checkedInPin)).toBe(checkedInPin);
    expect(checkedInPin.sha256).toBe("98e3210587886cedcec8d9564591eeb5448e154ee794d850ea19a5d59bf03e97");
  });

  it("accepts an exact, immutable macOS arm64 release and rejects floating versions", () => {
    expect(validateInkPin(pin)).toBe(pin);
    expect(() => validateInkPin({ ...pin, url: "https://github.com/Devaretanmay/ink/releases/latest/download/runtime.zip" })).toThrow(/immutable versioned/);
  });

  it("fails closed on missing checksum or incompatible platform/protocol", () => {
    expect(() => validateInkPin({ ...pin, sha256: "" })).toThrow(/SHA-256/);
    expect(() => validateInkPin(pin, "win32", "x64")).toThrow(/supports only/);
    expect(() => validateInkPin({ ...pin, bridge_protocol_version: 2 })).toThrow(/compatibility/);
  });
});

describe("Ink archive paths", () => {
  it("allows entries under one artifact root", () => {
    expect(assertSafeArchiveEntries([
      "ink-runtime-0.6.0rc2.1-darwin-arm64/",
      "ink-runtime-0.6.0rc2.1-darwin-arm64/runtime/model/model.safetensors",
    ], "ink-runtime-0.6.0rc2.1-darwin-arm64")).toHaveLength(2);
  });

  it("rejects traversal, absolute paths, and alternate top-level roots", () => {
    for (const entry of [
      "../payload",
      "/tmp/payload",
      "other-root/payload",
      "ink-runtime-0.6.0rc2.1-darwin-arm64/runtime/../../outside",
    ]) {
      expect(() => assertSafeArchiveEntries([entry], "ink-runtime-0.6.0rc2.1-darwin-arm64")).toThrow(/unsafe/);
    }
  });
});
