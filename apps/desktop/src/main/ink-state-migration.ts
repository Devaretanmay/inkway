import { execFileSync } from "node:child_process";
import { existsSync, linkSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

const SQLITE_BACKUP = String.raw`
import sqlite3, sys
from pathlib import Path
source, target = sys.argv[1], sys.argv[2]
src = sqlite3.connect(Path(source).resolve().as_uri() + '?mode=ro', uri=True, timeout=10)
dst = sqlite3.connect(target, timeout=10)
try:
    src.backup(dst)
    result = dst.execute('PRAGMA integrity_check').fetchone()
    if not result or result[0] != 'ok':
        raise RuntimeError('integrity check failed')
    dst.commit()
finally:
    dst.close()
    src.close()
`;

/** Copy legacy Microloop decision history into Ink's normal database path.
 * SQLite's backup API includes committed WAL data and leaves the source intact.
 * A verified staging file is atomically renamed into place, making retries safe.
 */
export function migrateLegacyInkDatabase(
  source: string,
  target: string,
  python: string,
): boolean {
  if (existsSync(target) || !existsSync(source)) return false;
  const parent = dirname(target);
  mkdirSync(parent, { recursive: true });
  const stagingDir = mkdtempSync(join(parent, ".ink-state-migration-"));
  const staging = join(stagingDir, "decisions.db");
  try {
    try {
      execFileSync(python, ["-c", SQLITE_BACKUP, source, staging], {
        stdio: "ignore",
        timeout: 30_000,
      });
    } catch {
      throw new Error("Could not verify legacy Ink decision database migration");
    }
    try {
      // Hard-link publication is atomic and fails with EEXIST instead of
      // replacing a database another Inkway instance created concurrently.
      linkSync(staging, target);
    } catch (error) {
      if (existsSync(target)) return false;
      throw error;
    }
    return true;
  } finally {
    rmSync(stagingDir, { recursive: true, force: true });
  }
}
