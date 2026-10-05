/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, module, process */

const { createHash } = require("node:crypto");
const { createReadStream, existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, statSync } = require("node:fs");
const { dirname, join, relative, resolve, sep } = require("node:path");

function digest(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

module.exports = async function verifyInkPackage(context) {
  if (context.electronPlatformName !== "darwin" || context.arch !== 3) {
    throw new Error("Inkway Ink model runtime is currently supported only in macOS arm64 packages");
  }
  const appName = `${context.packager.appInfo.productFilename}.app`;
  const root = join(context.appOutDir, appName, "Contents", "Resources", "ink");
  const verifyRelocatableLinks = (directory) => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      const info = lstatSync(path);
      if (info.isSymbolicLink()) {
        const destination = readlinkSync(path);
        const absoluteDestination = resolve(dirname(path), destination);
        const escaped = relative(root, absoluteDestination);
        if (destination.startsWith("/") || escaped === ".." || escaped.startsWith(`..${sep}`)) {
          throw new Error(`Ink runtime contains a non-relocatable symlink: ${relative(root, path)}`);
        }
      } else if (info.isDirectory()) {
        verifyRelocatableLinks(path);
      }
    }
  };
  verifyRelocatableLinks(root);
  const compatibility = JSON.parse(readFileSync(join(root, "compatibility.json"), "utf8"));
  const release = JSON.parse(readFileSync(join(root, "release-manifest.json"), "utf8"));
  const trained = JSON.parse(readFileSync(join(root, "model", "ink-model.json"), "utf8"));
  if (compatibility.format_version !== 1 || compatibility.bridge_protocol_version !== 1) throw new Error("unsupported Ink runtime manifest");
  if (!/^[a-f0-9]{64}$/.test(compatibility.runtime_lock_sha256 || "")) throw new Error("Ink runtime lock checksum is missing");
  if (compatibility.inkway_version !== context.packager.appInfo.version) throw new Error("Ink manifest Inkway version mismatch");
  if (compatibility.ink_version !== "0.6.0rc2" || compatibility.model_name !== trained.name || compatibility.model_version !== trained.version) throw new Error("Ink runtime/model version mismatch");
  if (release.ink_engine_version !== compatibility.ink_version || release.model_identifier !== trained.name || release.model_version !== trained.version || release.bridge_protocol_version !== compatibility.bridge_protocol_version || release.platform !== "darwin" || release.architecture !== "arm64") throw new Error("Ink release artifact compatibility mismatch");
  if (trained.name !== "ink-decision-v1" || trained.weights_modified !== true || !trained.trained_by) throw new Error("packaged checkpoint is not the Ink-trained model");
  if (trained.base_checkpoint && trained.base_checkpoint.startsWith("/")) throw new Error("developer absolute path found in packaged model manifest");
  const python = join(root, "python", "cpython-3.13.12-macos-aarch64-none", "bin", "python3.13");
  if (!existsSync(python) || (statSync(python).mode & 0o111) === 0) throw new Error("bundled Python runtime is missing or not executable");
  const sitePackages = join(root, "site-packages");
  if (!existsSync(join(sitePackages, "ink", "__init__.py")) || !existsSync(join(sitePackages, "mlx", "core.cpython-313-darwin.so")) || !existsSync(join(sitePackages, "mlx", "lib", "mlx.metallib")) || !existsSync(join(sitePackages, "mlx_metal-0.32.2.dist-info", "METADATA"))) throw new Error("bundled Ink dependencies are incomplete");
  for (const [relative, expected] of Object.entries(trained.sha256 || {})) {
    const file = join(root, "model", relative);
    if (!existsSync(file) || await digest(file) !== expected) throw new Error(`packaged model integrity check failed: ${relative}`);
  }
  if (trained.sha256["model.safetensors"] !== compatibility.model_weights_sha256) throw new Error("packaged model weight checksum differs from compatibility manifest");
  if (await digest(join(root, "model", "ink-model.json")) !== compatibility.model_manifest_sha256) throw new Error("packaged model manifest checksum differs from compatibility manifest");
  if (await digest(join(root, "bridge", "bridge.py")) !== release.bridge_sha256) throw new Error("packaged bridge checksum differs from Ink release manifest");
  if (await digest(join(root, "bridge", "db_migration.py")) !== release.state_migration_sha256) throw new Error("packaged Ink state migration checksum differs from release manifest");
  process.stdout.write(`[ink-package] verified ${compatibility.ink_version} + ${compatibility.model_name} ${compatibility.model_version}\n`);
};
