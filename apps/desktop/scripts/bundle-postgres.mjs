#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { chmod, copyFile, mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(here, "..");
const resourceRoot = join(desktopRoot, "resources", "postgres");
const releaseURL = "https://github.com/PostgresApp/PostgresApp/releases/download/v2.9.6/Postgres-2.9.6-18.dmg";
const releaseSHA256 = "9fc7d0dc08cf46dfd94bb32cbaaad81b41b37847a42d6dcb2f9fbd292813defb";
const cacheRoot = join(desktopRoot, ".cache");
const imagePath = join(cacheRoot, "Postgres-2.9.6-18.dmg");

if (process.platform !== "darwin") {
  throw new Error("The bundled Postgres.app runtime currently supports macOS packages only.");
}

await mkdir(cacheRoot, { recursive: true });
await mkdir(resourceRoot, { recursive: true });
if (!(await exists(join(resourceRoot, "18", "bin", "postgres")))) {
  if (!(await exists(imagePath))) {
    const response = await fetch(releaseURL, { redirect: "follow" });
    if (!response.ok || !response.body) throw new Error(`PostgreSQL download failed: HTTP ${response.status}`);
    await pipeline(response.body, createWriteStream(imagePath, { mode: 0o600 }));
  }
  const digest = await sha256(imagePath);
  if (digest !== releaseSHA256) throw new Error(`PostgreSQL archive checksum mismatch: ${digest}`);

  const mountRoot = await mkdtemp(join(tmpdir(), "inkway-postgres-"));
  const mountPoint = join(mountRoot, "mnt");
  await mkdir(mountPoint);
  try {
    execFileSync("hdiutil", ["attach", "-nobrowse", "-readonly", "-mountpoint", mountPoint, imagePath], { stdio: "inherit" });
    const appRoot = join(mountPoint, "Postgres.app", "Contents");
    await copyTree(join(appRoot, "Versions", "18"), join(resourceRoot, "18"));
    await copyFile(join(appRoot, "Resources", "Credits.rtf"), join(resourceRoot, "CREDITS.rtf"));
  } finally {
    try {
      execFileSync("hdiutil", ["detach", mountPoint], { stdio: "ignore" });
    } catch {
      // Keep the original bundling error; hdiutil detach is best effort.
    }
    await rm(mountRoot, { recursive: true, force: true });
  }
}

console.log(`[bundle-postgres] PostgreSQL 18 runtime ready at ${resourceRoot}`);

async function exists(path) {
  try { await stat(path); return true; } catch { return false; }
}

async function sha256(path) {
  const hash = createHash("sha256");
  const { createReadStream } = await import("node:fs");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function copyTree(source, destination) {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isDirectory()) await copyTree(from, to);
    else if (entry.isSymbolicLink()) {
      const { readlink, symlink } = await import("node:fs/promises");
      await symlink(await readlink(from), to);
    } else {
      await copyFile(from, to);
      if (entry.name === "postgres" || entry.name === "pg_ctl" || entry.name === "initdb" || entry.name === "createdb" || entry.name === "psql") await chmod(to, 0o755);
    }
  }
}
