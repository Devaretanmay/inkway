#!/usr/bin/env node
// Build the zero-cost macOS alpha release files from an electron-builder
// output directory.
//
// Given a dist/ containing the ad-hoc signed Inkway DMG + ZIP, this script:
//   1. refuses to run on a dirty tracked tree (release must be reproducible);
//   2. locates Inkway-<version>-mac-arm64.{dmg,zip} and rejects banned name
//      fragments (dirty, multica, issuway, microloop);
//   3. verifies DMG integrity (hdiutil verify), mounts it read-only, and
//      verifies the enclosed Inkway.app (bundle id, arm64 arch, ad-hoc
//      codesign --verify --deep --strict);
//   4. verifies ZIP integrity (unzip -t);
//   5. writes SHA256SUMS and verifies it round-trips (shasum -c);
//   6. writes release-manifest.json (versions, hashes, commit, date,
//      notarized:false, signing:"ad-hoc").
//
// Any failure exits non-zero BEFORE any GitHub Release upload, so CI can
// gate publishing on this script. No Apple Developer identity, no
// notarization, no paid infrastructure is used or required.

import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(here, "..");
const repoRoot = resolve(desktopRoot, "..", "..");

const BANNED_NAME_FRAGMENTS = ["dirty", "multica", "issuway", "microloop"];

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : (process.argv[index + 1] ?? fallback);
}

function run(command, args, options = {}) {
  // unzip -t on the ~2.4 GB/18k-file archive prints megabytes of progress;
  // the default 1 MB exec buffer would fail with ENOBUFS.
  return execFileSync(command, args, { encoding: "utf8", stdio: "pipe", maxBuffer: 256 * 1024 * 1024, ...options });
}

function sha256File(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
}

function fail(message) {
  console.error(`[alpha-release] FAIL: ${message}`);
  process.exit(1);
}

function log(message) {
  console.log(`[alpha-release] ${message}`);
}

const distDir = resolve(arg("--dist", join(desktopRoot, "dist")));
const version = arg("--version", "").replace(/^v/, "");
if (!version) fail("missing --version <x.y.z[-suffix]> (pass the release version without a leading v)");
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  fail(`version ${JSON.stringify(version)} is not semver (expected x.y.z[-suffix])`);
}

// 1. Tracked tree must be clean: a release build has to come from a commit.
try {
  run("git", ["diff", "--quiet"], { cwd: repoRoot });
  run("git", ["diff", "--cached", "--quiet"], { cwd: repoRoot });
} catch {
  fail("tracked working tree has uncommitted changes; commit before building release artifacts");
}
const commit = run("git", ["rev-parse", "HEAD"], { cwd: repoRoot }).trim();
log(`source commit ${commit}`);

// 2. Locate artifacts; enforce the clean alpha naming scheme.
const base = `Inkway-${version}-mac-arm64`;
const dmgName = `${base}.dmg`;
const zipName = `${base}.zip`;
const dmgPath = join(distDir, dmgName);
const zipPath = join(distDir, zipName);
for (const artifact of [dmgPath, zipPath]) {
  if (!existsSync(artifact)) fail(`missing expected artifact ${artifact}`);
  const lower = basename(artifact).toLowerCase();
  for (const fragment of BANNED_NAME_FRAGMENTS) {
    if (lower.includes(fragment)) fail(`artifact name ${basename(artifact)} contains banned fragment ${JSON.stringify(fragment)}`);
  }
  log(`found ${basename(artifact)}`);
}

// 3. DMG integrity + mounted .app verification.
log(`verifying DMG integrity: ${dmgName}`);
try {
  run("hdiutil", ["verify", dmgPath]);
} catch (error) {
  fail(`DMG checksum verification failed: ${error.message}`);
}
const mountParent = mkdtempSync(join(tmpdir(), "inkway-alpha-"));
const mountPoint = join(mountParent, "mnt");
let appPath = "";
let mounted = false;
try {
  execFileSync("mkdir", ["-p", mountPoint]);
  run("hdiutil", ["attach", "-nobrowse", "-readonly", "-mountpoint", mountPoint, dmgPath]);
  mounted = true;
  appPath = join(mountPoint, "Inkway.app");
  if (!existsSync(appPath)) fail("DMG does not contain Inkway.app at its root");
  log("mounted DMG; Inkway.app present");

  // Bundle identifier from the packaged Info.plist.
  const bundleId = run("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleIdentifier", join(appPath, "Contents", "Info.plist")]).trim();
  if (bundleId !== "io.github.devaretanmay.inkway") fail(`unexpected bundle identifier ${JSON.stringify(bundleId)}`);
  log(`bundle identifier ${bundleId}`);

  // Architecture: the main executable must be arm64.
  const executableName = run("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleExecutable", join(appPath, "Contents", "Info.plist")]).trim();
  const machoInfo = run("file", [join(appPath, "Contents", "MacOS", executableName)]);
  if (!machoInfo.includes("arm64")) fail(`main executable is not arm64: ${machoInfo.trim()}`);
  log(`architecture arm64 (${machoInfo.trim().slice(0, 120)})`);

  // Ad-hoc signature verification (deep + strict). This proves the bundle is
  // consistently signed; it is NOT Apple notarization and must not be
  // presented as such.
  try {
    run("codesign", ["--verify", "--deep", "--strict", appPath]);
  } catch (error) {
    fail(`codesign verification failed: ${error.message}`);
  }
  log("codesign --verify --deep --strict passed");

  // codesign -dv prints to stderr; capture it to assert Signature=adhoc.
  const displayed = spawnSync("codesign", ["-dv", appPath], { encoding: "utf8" });
  const combined = String(displayed.stderr ?? "") + String(displayed.stdout ?? "");
  if (!combined.includes("Signature=adhoc")) {
    fail(`expected an ad-hoc signature (Signature=adhoc) on Inkway.app, got: ${combined.slice(0, 300)}`);
  }
  log("signing: ad-hoc (not Developer ID, not notarized)");
} finally {
  // Detach must succeed: a stale mount would let later runs inspect the
  // wrong bytes. A freshly mounted multi-GB volume can stay briefly busy
  // (e.g. Spotlight indexing), so retry before giving up, then fail loudly
  // rather than continuing with a stale mount. Skipped when the attach
  // itself failed so the real error is never masked by a detach complaint.
  if (mounted) {
    let detached = false;
    for (let attempt = 0; attempt < 6 && !detached; attempt += 1) {
      for (const args of [[mountPoint], ["-force", mountPoint]]) {
        try {
          execFileSync("hdiutil", ["detach", ...args], { stdio: "pipe" });
          detached = true;
          break;
        } catch {
          // Fall through to the forced detach, then to the next retry.
        }
      }
      if (!detached && attempt < 5) {
        execFileSync("sleep", ["5"], { stdio: "ignore" });
      }
    }
    if (!detached) {
      fail(`could not detach release DMG at ${mountPoint}; refusing to continue with a stale mount`);
    }
  }
  rmSync(mountParent, { recursive: true, force: true });
}

// 4. ZIP integrity.
log(`testing ZIP integrity: ${zipName}`);
try {
  run("unzip", ["-t", zipPath]);
} catch (error) {
  fail(`ZIP integrity test failed: ${error.message}`);
}
const zipList = run("unzip", ["-Z1", zipPath]);
if (!zipList.split(/\r?\n/).some((line) => line.trim() === "Inkway.app/Contents/MacOS/Inkway" || line.startsWith("Inkway.app/"))) {
  fail("ZIP does not contain Inkway.app");
}
log("ZIP contains Inkway.app and passed integrity test");

// 5. SHA256SUMS generation + round-trip verification.
//
// GitHub Releases rejects files >= 2 GiB, and this bundle compresses to
// ~2.4 GB (the trained Ink model alone is ~0.8 GB and must ship). Any
// artifact at or above 1500 MB is therefore split into numbered parts
// (`<name>.part-00`, …) with `split -b 1500M`. SHA256SUMS lists every part
// as a checkable `<sha>  <filename>` line so `shasum -c` verifies the
// download; the whole-file hashes are recorded both as `#` comment lines
// and in release-manifest.json. The reassembly check below (cat parts and
// compare against the whole-file hash) proves the parts reconstruct the
// verified bytes exactly.
const dmgSha = await sha256File(dmgPath);
const zipSha = await sha256File(zipPath);
const SPLIT_BYTES = 1500 * 1024 * 1024;
async function maybeSplit(artifactPath, artifactSha) {
  const { statSync } = await import("node:fs");
  if (statSync(artifactPath).size < SPLIT_BYTES) return null;
  const prefix = `${artifactPath}.part-`;
  run("split", ["-b", String(SPLIT_BYTES), "-d", artifactPath, prefix]);
  const { readdirSync } = await import("node:fs");
  const parts = readdirSync(distDir)
    .filter((name) => name.startsWith(`${basename(artifactPath)}.part-`))
    .sort();
  if (parts.length < 2) fail(`splitting ${basename(artifactPath)} produced no parts`);
  const partLines = [];
  for (const part of parts) {
    partLines.push(`${await sha256File(join(distDir, part))}  ${part}`);
  }
  // Prove the parts reassemble to the verified whole file. prefix already
  // ends in ".part-", so the glob is "<prefix>*".
  const reassembled = run("sh", ["-c", `cat ${prefix.replace(/'/g, "'\\''")}* | shasum -a 256`]).split(/\s+/)[0];
  if (reassembled !== artifactSha) fail(`reassembled ${basename(artifactPath)} hash mismatch: parts do not reconstruct the verified file`);
  log(`${basename(artifactPath)} split into ${parts.length} parts; reassembly verified`);
  return partLines;
}
const sumsLines = [];
const dmgParts = await maybeSplit(dmgPath, dmgSha);
const zipParts = await maybeSplit(zipPath, zipSha);
if (dmgParts) {
  sumsLines.push(...dmgParts);
  sumsLines.push(`# whole-file ${dmgName}: ${dmgSha}`);
} else {
  sumsLines.push(`${dmgSha}  ${dmgName}`);
}
if (zipParts) {
  sumsLines.push(...zipParts);
  sumsLines.push(`# whole-file ${zipName}: ${zipSha}`);
} else {
  sumsLines.push(`${zipSha}  ${zipName}`);
}
const sumsPath = join(distDir, "SHA256SUMS");
writeFileSync(sumsPath, `${sumsLines.join("\n")}\n`);
log(`wrote SHA256SUMS:\n  ${sumsLines.join("\n  ")}`);
try {
  run("shasum", ["-a", "256", "-c", sumsPath], { cwd: distDir });
} catch (error) {
  fail(`SHA256SUMS self-verification failed: ${error.message}`);
}
log("SHA256SUMS verifies (shasum -c OK)");

// 6. Release manifest. Ink versions come from the pinned runtime pin file;
// cross-checked against the staged resources when present.
const pinPath = join(desktopRoot, "scripts", "ink-runtime.json");
const pin = JSON.parse(readFileSync(pinPath, "utf8"));
const stagedCompatPath = join(desktopRoot, "resources", "ink", "compatibility.json");
if (existsSync(stagedCompatPath)) {
  const staged = JSON.parse(readFileSync(stagedCompatPath, "utf8"));
  for (const [field, expected] of Object.entries({
    ink_version: pin.ink_engine_version,
    model_name: pin.model_identifier,
    model_version: pin.model_version,
  })) {
    if (staged[field] !== expected) fail(`staged Ink compatibility.json ${field} mismatch (pin vs staged)`);
  }
  log("staged Ink runtime matches the pin file");
}
const manifest = {
  inkway_version: version,
  ink_engine_version: pin.ink_engine_version,
  ink_runtime_version: pin.artifact_version,
  ink_model: pin.model_identifier,
  ink_model_version: pin.model_version,
  ink_model_sha256: pin.model_sha256,
  platform: "darwin",
  architecture: "arm64",
  dmg: dmgName,
  dmg_sha256: dmgSha,
  zip: zipName,
  zip_sha256: zipSha,
  // Present only when the artifact exceeded the release-host file cap and
  // was split; each part is listed in SHA256SUMS as a checkable line.
  // Reassemble with: cat <name>.part-* > <name>, then `shasum -c SHA256SUMS`
  // is NOT sufficient — verify the whole file against *_sha256 above.
  ...(dmgParts ? { dmg_parts: dmgParts.map((line) => line.split(/\s+/)[1]) } : {}),
  ...(zipParts ? { zip_parts: zipParts.map((line) => line.split(/\s+/)[1]) } : {}),
  git_commit: commit,
  build_date: new Date().toISOString(),
  notarized: false,
  signing: "ad-hoc",
};
const manifestPath = join(distDir, "release-manifest.json");
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
log(`wrote release-manifest.json (inkway ${version}, ink engine ${pin.ink_engine_version}, runtime ${pin.artifact_version}, model ${pin.model_identifier} ${pin.model_version})`);

console.log(`[alpha-release] READY: ${dmgName}, ${zipName}, SHA256SUMS, release-manifest.json`);
