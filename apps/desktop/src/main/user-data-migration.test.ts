import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { legacyDataCandidates, migrateLegacyDirectory } from "./user-data-migration";

const temporary: string[] = [];
function tempDirectory() {
  const path = mkdtempSync(join(tmpdir(), "inkway-migration-test-"));
  temporary.push(path);
  return path;
}

afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("desktop data migration", () => {
  it("copies and verifies the first supported legacy folder without deleting it", () => {
    const parent = tempDirectory();
    const source = join(parent, "Microloop");
    mkdirSync(join(source, "IndexedDB"), { recursive: true });
    writeFileSync(join(source, "settings.json"), '{"theme":"dark"}');
    writeFileSync(join(source, "IndexedDB", "state"), "persisted state");

    const result = migrateLegacyDirectory(parent, "Inkway", ["Microloop", "Issuway"]);

    expect(result.migrated).toBe(true);
    expect(readFileSync(join(parent, "Inkway", "settings.json"), "utf8")).toBe(
      '{"theme":"dark"}',
    );
    expect(readFileSync(join(parent, "Microloop", "IndexedDB", "state"), "utf8")).toBe(
      "persisted state",
    );
  });

  it("is idempotent and never overwrites an existing Inkway directory", () => {
    const parent = tempDirectory();
    mkdirSync(join(parent, "Issuway"));
    writeFileSync(join(parent, "Issuway", "old"), "legacy");
    mkdirSync(join(parent, "Inkway"));
    writeFileSync(join(parent, "Inkway", "current"), "current");

    const result = migrateLegacyDirectory(parent, "Inkway", ["Issuway"]);

    expect(result.migrated).toBe(false);
    expect(readFileSync(join(parent, "Inkway", "current"), "utf8")).toBe("current");
  });

  it("orders suffixed development folders before shared production folders", () => {
    expect(legacyDataCandidates("worktree-1").slice(0, 3)).toEqual([
      "Microloop worktree-1",
      "Issuway Canary worktree-1",
      "Multica worktree-1",
    ]);
  });
});
