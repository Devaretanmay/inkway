#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(desktopRoot, "../..");
const pinPath = join(desktopRoot, "scripts/ink-runtime.json");
const cacheRoot = join(desktopRoot, ".runtime-cache");
const resourcesRoot = join(desktopRoot, "resources/ink");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "pipe", encoding: "utf8", maxBuffer: 128 * 1024 * 1024, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

export function validateInkPin(pin, targetPlatform = pin.platform, targetArch = pin.architecture) {
  if (!pin || pin.platform !== "darwin" || pin.architecture !== "arm64" || targetPlatform !== pin.platform || targetArch !== pin.architecture) {
    throw new Error(`pinned Ink artifact supports only ${pin?.platform}/${pin?.architecture}; got ${targetPlatform}/${targetArch}`);
  }
  if (!/^[a-f0-9]{64}$/.test(pin.sha256 ?? "") || !/^[a-f0-9]{64}$/.test(pin.model_sha256 ?? "")) {
    throw new Error("Ink runtime pin has no valid artifact/model SHA-256; refusing an unverified artifact");
  }
  const url = new URL(pin.url);
  if (url.protocol !== "https:" || url.hostname !== "github.com" || !url.pathname.startsWith(`/Devaretanmay/ink/releases/download/ink-runtime-v${pin.artifact_version}/`)) {
    throw new Error("Ink runtime URL must be an immutable versioned GitHub Release asset");
  }
  if (pin.ink_engine_version !== "0.6.0rc2" || pin.model_identifier !== "ink-decision-v1" || pin.model_version !== "1.0.0" || pin.bridge_protocol_version !== 1) {
    throw new Error("Ink runtime pin has unsupported engine/model/protocol compatibility");
  }
  return pin;
}

export function assertSafeArchiveEntries(names, expectedRoot) {
  if (!names.length) throw new Error("Ink archive is empty");
  for (const name of names) {
    const normalized = name.replaceAll("\\", "/");
    const parts = normalized.split("/");
    if (normalized.startsWith("/") || parts.includes("..") || parts[0] !== expectedRoot || normalized.includes("\0")) {
      throw new Error(`unsafe or unexpected path in Ink archive: ${name}`);
    }
  }
  return names;
}

async function sha256(file) {
  const hash = createHash("sha256");
  const { createReadStream } = await import("node:fs");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

function safeArchiveListing(archive, expectedRoot) {
  const names = run("unzip", ["-Z1", archive]).split(/\r?\n/).filter(Boolean);
  return assertSafeArchiveEntries(names, expectedRoot);
}

export async function provisionInkRuntime({ targetPlatform = process.platform, targetArch = process.arch, inkwayVersion } = {}) {
  const pin = JSON.parse(readFileSync(pinPath, "utf8"));
  validateInkPin(pin, targetPlatform, targetArch);
  const file = join(cacheRoot, basename(new URL(pin.url).pathname));
  mkdirSync(cacheRoot, { recursive: true });
  if (!existsSync(file)) {
    const temporary = `${file}.download`;
    rmSync(temporary, { force: true });
    const response = await fetch(pin.url, { redirect: "follow" });
    if (!response.ok || !response.body) throw new Error(`Ink release download failed with HTTP ${response.status}`);
    const finalUrl = new URL(response.url);
    if (!finalUrl.hostname.endsWith("github.com") && !finalUrl.hostname.endsWith("githubusercontent.com")) {
      throw new Error(`unexpected Ink artifact download host: ${finalUrl.hostname}`);
    }
    await pipeline(response.body, createWriteStream(temporary, { flags: "wx" }));
    const actual = await sha256(temporary);
    if (actual !== pin.sha256) {
      rmSync(temporary, { force: true });
      throw new Error(`Ink artifact SHA-256 mismatch: expected ${pin.sha256}, got ${actual}`);
    }
    renameSync(temporary, file);
  }
  const actual = await sha256(file);
  if (actual !== pin.sha256) throw new Error(`cached Ink artifact SHA-256 mismatch: expected ${pin.sha256}, got ${actual}`);

  const rootName = `ink-runtime-${pin.artifact_version}-darwin-arm64`;
  const names = safeArchiveListing(file, rootName);
  const temp = join(cacheRoot, `.extract-${process.pid}`);
  rmSync(temp, { recursive: true, force: true });
  mkdirSync(temp, { recursive: true });
  // Archive bytes are verified before invoking the extractor; listing rejects
  // traversal and unexpected top-level entries.
  run("ditto", ["-x", "-k", file, temp]);
  const extracted = join(temp, rootName);
  const release = JSON.parse(readFileSync(join(extracted, "manifest.json"), "utf8"));
  for (const [field, expected] of Object.entries({
    artifact_version: pin.artifact_version,
    ink_engine_version: pin.ink_engine_version,
    model_version: pin.model_version,
    model_identifier: pin.model_identifier,
    bridge_protocol_version: pin.bridge_protocol_version,
    platform: pin.platform,
    architecture: pin.architecture,
    model_sha256: pin.model_sha256,
  })) {
    if (release[field] !== expected) throw new Error(`Ink release manifest mismatch for ${field}`);
  }
  const runtime = join(extracted, "runtime");
  const compatibility = JSON.parse(readFileSync(join(runtime, "compatibility.json"), "utf8"));
  if (compatibility.ink_version !== pin.ink_engine_version || compatibility.model_name !== pin.model_identifier || compatibility.model_version !== pin.model_version || compatibility.bridge_protocol_version !== pin.bridge_protocol_version || compatibility.platform !== `${pin.platform}-${pin.architecture}`) {
    throw new Error("Ink runtime compatibility manifest does not match Inkway pin");
  }
  const modelManifest = JSON.parse(readFileSync(join(runtime, "model/ink-model.json"), "utf8"));
  if (modelManifest.name !== pin.model_identifier || modelManifest.version !== pin.model_version || modelManifest.weights_modified !== true || modelManifest.sha256?.["model.safetensors"] !== pin.model_sha256) {
    throw new Error("trained model identity/checksum does not match Inkway pin");
  }
  const modelRoot = resolve(runtime, "model");
  for (const [relative, expected] of Object.entries(modelManifest.sha256)) {
    const modelFile = resolve(modelRoot, relative);
    if (relative.startsWith("/") || relative.split(/[\\/]/).includes("..") || !modelFile.startsWith(`${modelRoot}${sep}`) || !existsSync(modelFile) || await sha256(modelFile) !== expected) {
      throw new Error(`trained model file integrity check failed: ${relative}`);
    }
  }
  if (!existsSync(join(runtime, "python")) || !existsSync(join(runtime, "site-packages")) || !existsSync(join(extracted, "bridge/bridge.py"))) {
    throw new Error("Ink artifact is incomplete or its model checksum differs");
  }
  if (await sha256(join(runtime, "compatibility.json")) !== release.runtime_manifest_sha256 || await sha256(join(extracted, "bridge/bridge.py")) !== release.bridge_sha256 || await sha256(join(extracted, "bridge/db_migration.py")) !== release.state_migration_sha256) {
    throw new Error("Ink runtime or bridge manifest checksum mismatch");
  }
  const appBridge = join(repoRoot, "server/internal/ink/bridge.py");
  if (!existsSync(appBridge) || await sha256(appBridge) !== release.bridge_sha256) {
    throw new Error("pinned Ink release bridge differs from Inkway's bridge source");
  }
  for (const entry of names) {
    const relative = entry.slice(rootName.length).replace(/^\//, "");
    if (!relative) continue;
    const target = resolve(extracted, relative);
    if (!target.startsWith(`${resolve(extracted)}/`) && target !== resolve(extracted)) throw new Error(`Ink archive path escaped extraction root: ${entry}`);
  }
  const verifyLinks = (directory) => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      const info = lstatSync(path);
      if (info.isSymbolicLink()) {
        const linkTarget = readlinkSync(path);
        if (isAbsolute(linkTarget)) throw new Error(`Ink archive contains an absolute symlink: ${path}`);
        const destination = resolve(dirname(path), linkTarget);
        const escaped = relative(extracted, destination);
        if (escaped === ".." || escaped.startsWith(`..${sep}`)) throw new Error(`Ink archive contains an escaping symlink: ${path}`);
      } else if (info.isDirectory()) verifyLinks(path);
    }
  };
  verifyLinks(extracted);
  const stage = `${resourcesRoot}.stage`;
  rmSync(stage, { recursive: true, force: true });
  run("ditto", [runtime, stage]);
  run("ditto", [join(extracted, "bridge"), join(stage, "bridge")]);
  const appManifest = JSON.parse(readFileSync(join(stage, "compatibility.json"), "utf8"));
  appManifest.inkway_version = inkwayVersion ?? "development";
  writeFileSync(join(stage, "compatibility.json"), `${JSON.stringify(appManifest, null, 2)}\n`);
  writeFileSync(join(stage, "release-manifest.json"), `${JSON.stringify(release, null, 2)}\n`);
  rmSync(resourcesRoot, { recursive: true, force: true });
  renameSync(stage, resourcesRoot);
  rmSync(temp, { recursive: true, force: true });
  console.log(`[ink-runtime] verified artifact ${pin.artifact_version} ${pin.sha256} (${names.length} archive entries)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const arg = (name, fallback) => {
      const i = process.argv.indexOf(name);
      return i < 0 ? fallback : process.argv[i + 1];
    };
    await provisionInkRuntime({
      targetPlatform: arg("--target-platform", process.platform === "darwin" ? "darwin" : process.platform),
      targetArch: arg("--target-arch", process.arch),
      inkwayVersion: arg("--inkway-version", JSON.parse(readFileSync(join(desktopRoot, "package.json"), "utf8")).version),
    });
  } catch (error) {
    console.error(`[ink-runtime] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
