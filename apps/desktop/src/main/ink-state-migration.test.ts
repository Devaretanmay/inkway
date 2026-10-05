import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrateLegacyInkDatabase } from "./ink-state-migration";

const temporary: string[] = [];
function tempDirectory() {
  const path = mkdtempSync(join(tmpdir(), "inkway-ink-state-"));
  temporary.push(path);
  return path;
}

afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("legacy Ink decision-state migration", () => {
  it("copies a consistent SQLite snapshot, verifies it, retains source, and is idempotent", () => {
    const root = tempDirectory();
    const source = join(root, ".microloop", "decisions.db");
    const target = join(root, "Inkway", "ink", "decisions.db");
    mkdirSync(join(root, ".microloop"));
    execFileSync("python3", ["-c", "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute('create table evidence(value text)'); c.execute('insert into evidence values (\"active-site\")'); c.commit(); c.close()", source]);

    expect(migrateLegacyInkDatabase(source, target, "python3")).toBe(true);
    expect(existsSync(source)).toBe(true);
    expect(readFileSync(target).length).toBeGreaterThan(0);
    expect(migrateLegacyInkDatabase(source, target, "python3")).toBe(false);
    const value = execFileSync("python3", ["-c", "import sqlite3,sys; print(sqlite3.connect(sys.argv[1]).execute('select value from evidence').fetchone()[0])", target], { encoding: "utf8" });
    expect(value.trim()).toBe("active-site");
  });

  it("leaves the old database untouched and exposes no partial target when source is invalid", () => {
    const root = tempDirectory();
    const source = join(root, "legacy.db");
    const target = join(root, "Inkway", "ink", "decisions.db");
    writeFileSync(source, "not-a-database");

    expect(() => migrateLegacyInkDatabase(source, target, "python3")).toThrow(/Could not verify/);
    expect(existsSync(source)).toBe(true);
    expect(existsSync(target)).toBe(false);
  });
});
