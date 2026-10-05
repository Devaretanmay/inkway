#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const allowed = [
  /^docs\/branding\//,
  /^docs\/inkway-domain-migration\.md$/,
  /^scripts\/check-brand-hygiene\.mjs$/,
  /^docs\/(legacy|evidence)\//,
  /^benchmarks\/results\//,
  /^artifacts\/archive\/pre-inkway\//,
  /^server\/migrations\//,
  /^server\/cmd\/migrate\/(main|migrate_runtime_ink_renamed_alias_test)\.go$/,
  /^apps\/desktop\/src\/main\/(index|daemon-manager|user-data-migration|ink-state-migration)\.(ts|test\.ts)$/,
  /^apps\/desktop\/electron-builder\.yml$/,
  /^server\/internal\/nativeagent\/secrets(_test)?\.go$/,
  /^server\/internal\/ink\/db_migration(_test)?\.py$/,
  /^packages\/core\/platform\/legacy-brand-storage(\.test)?\.ts$/,
  /^packages\/core\/api\/client\.ts$/,
  /^python\/ink\/ink\/(decision_api|internal\/model\/registry)\.py$/,
  /^python\/ink\/tests\/test_(integrated_model|migration_and_failures)\.py$/,
  /^deploy\/helm\/inkway\/templates\/_helpers\.tpl$/,
  /^apps\/(desktop|mobile)\/\.env\.staging$/,
  /^third_party\/ink\/.*\/NOTICE$/,
];
const legacy = /microloop|issuway|multica/i;
const oldServiceHosts = /(?:[\w-]+\.)*multica\.ai|(?:multica-api|multica-app)\.copilothub\.ai/gi;

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8" })
  .split("\0").filter(Boolean);
const violations = [];
for (const file of files) {
  if (allowed.some((pattern) => pattern.test(file))) continue;
  if (/\.(png|jpe?g|gif|webp|mp4|zip|dmg|pdf|woff2?|ttf|ico|icns)$/i.test(file)) continue;
  let bytes;
  try { bytes = readFileSync(file); } catch { continue; }
  if (bytes.subarray(0, 8192).includes(0)) continue;
  const content = bytes.toString("utf8")
    .replace(oldServiceHosts, "<existing-service-host>")
    .replace(/multicast/gi, "network-group");
  if (legacy.test(file) || legacy.test(content)) violations.push(file);
}
if (violations.length) {
  console.error("Retired branding outside migration/history allowlist:");
  for (const file of [...new Set(violations)].sort()) console.error(`  ${file}`);
  process.exit(1);
}
console.log(`Brand hygiene passed (${files.length} tracked/unignored files; migration and history allowlist applied).`);
