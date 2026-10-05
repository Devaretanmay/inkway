#!/usr/bin/env node
import { provisionInkRuntime } from "./fetch-ink-runtime.mjs";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const project = JSON.parse(readFileSync(join(desktopRoot, "package.json"), "utf8"));
const argument = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
};

try {
  await provisionInkRuntime({
    targetPlatform: argument("--target-platform", process.platform),
    targetArch: argument("--target-arch", process.arch),
    inkwayVersion: argument("--inkway-version", project.version),
  });
} catch (error) {
  console.error(`[ink-runtime] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
