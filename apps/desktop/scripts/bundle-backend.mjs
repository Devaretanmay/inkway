#!/usr/bin/env node
import { chmod, mkdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(here, "..");
const repoRoot = resolve(desktopRoot, "..", "..");
const serverRoot = join(repoRoot, "server");
const platformArgs = process.argv.slice(2);
const platform = flagValue(platformArgs, "--target-platform") || process.platform;
const arch = flagValue(platformArgs, "--target-arch") || process.arch;
const goos = { darwin: "darwin", win32: "windows", linux: "linux" }[platform];
const goarch = { arm64: "arm64", x64: "amd64" }[arch];
if (!goos || !goarch) throw new Error(`Unsupported backend target ${platform}/${arch}`);

const outputDir = join(desktopRoot, "resources", "server");
const suffix = platform === "win32" ? ".exe" : "";
await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

for (const [name, packagePath] of [
  ["inkway-server", "./cmd/server"],
  ["inkway-migrate", "./cmd/migrate"],
]) {
  const destination = join(outputDir, `${name}${suffix}`);
  console.log(`[bundle-backend] ${platform}/${arch} ${packagePath} → ${destination}`);
  execFileSync("go", ["build", "-trimpath", "-o", destination, packagePath], {
    cwd: serverRoot,
    stdio: "inherit",
    env: { ...process.env, CGO_ENABLED: "0", GOOS: goos, GOARCH: goarch },
  });
  if (platform !== "win32") await chmod(destination, 0o755);
}

function flagValue(args, flag) {
  const index = args.indexOf(flag);
  return index < 0 ? "" : args[index + 1] || "";
}
