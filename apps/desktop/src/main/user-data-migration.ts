import {
  closeSync,
  cpSync,
  existsSync,
  openSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { basename, join, relative } from "node:path";

function hashFileSync(path: string): string {
  const hash = createHash("sha256");
  const fd = openSync(path, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytes = 0;
    while ((bytes = readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, bytes));
    }
  } finally {
    closeSync(fd);
  }
  return hash.digest("hex");
}

function snapshot(root: string): Map<string, string> {
  const result = new Map<string, string>();
  const visit = (directory: string) => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      const key = relative(root, path);
      const info = lstatSync(path);
      if (info.isSymbolicLink()) result.set(key, `link:${readlinkSync(path)}`);
      else if (info.isDirectory()) {
        result.set(`${key}/`, "directory");
        visit(path);
      } else if (info.isFile()) {
        result.set(key, `file:${info.size}:${hashFileSync(path)}`);
      } else {
        throw new Error(`Unsupported entry in application data: ${key}`);
      }
    }
  };
  visit(root);
  return result;
}

/** Copy old desktop state once. Source stays in place; target appears atomically. */
export function migrateLegacyDirectory(
  parent: string,
  targetName: string,
  legacyNames: string[],
): { migrated: boolean; source?: string; target: string } {
  const target = join(parent, targetName);
  if (existsSync(target)) return { migrated: false, target };
  const sourceName = legacyNames.find((name) => {
    const path = join(parent, name);
    return path !== target && existsSync(path) && lstatSync(path).isDirectory();
  });
  if (!sourceName) return { migrated: false, target };

  const source = join(parent, sourceName);
  mkdirSync(parent, { recursive: true });
  const stagingParent = mkdtempSync(join(parent, ".inkway-data-migration-"));
  const staging = join(stagingParent, targetName);
  try {
    cpSync(source, staging, { recursive: true, dereference: false, preserveTimestamps: true });
    const before = snapshot(source);
    const after = snapshot(staging);
    if (before.size !== after.size || [...before].some(([key, value]) => after.get(key) !== value)) {
      throw new Error(`Application data migration verification failed for ${basename(source)}`);
    }
    // Same-volume rename makes an interrupted copy invisible as the target.
    renameSync(staging, target);
    return { migrated: true, source, target };
  } finally {
    rmSync(stagingParent, { recursive: true, force: true });
  }
}

export function legacyDataCandidates(suffix?: string): string[] {
  const suffixed = suffix ? [`Microloop ${suffix}`, `Issuway Canary ${suffix}`, `Multica ${suffix}`] : [];
  return [...suffixed, "Microloop", "Issuway", "Multica"];
}
