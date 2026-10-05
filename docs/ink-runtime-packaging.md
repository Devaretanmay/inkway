# Inkway Ink runtime packaging

## Current dependency chain

The desktop packager calls `apps/desktop/scripts/package-ink-runtime.mjs`. That command now delegates to `fetch-ink-runtime.mjs`, reads the exact release pin in `apps/desktop/scripts/ink-runtime.json`, verifies the downloaded ZIP SHA-256 before extraction, rejects unsafe archive paths, validates release/runtime/model/protocol metadata and hashes, checks the released Python bridge against the Inkway bridge source, then stages the verified runtime under `apps/desktop/resources/ink`. Electron Builder embeds that tree in `Contents/Resources/ink`. The app stores learned decision state separately under the platform's Inkway Application Support directory, so replacing the app does not remove it.

The desktop package embeds the published Ink `0.6.0rc2` runtime and trained model. Build cache is `apps/desktop/.runtime-cache`; it contains the verified archive and packaging staging, never user decision state.

## Pin and release contract

Inkway pins artifact `0.6.0rc2.1`, engine `0.6.0rc2`, model `ink-decision-v1` version `1.0.0`, bridge protocol `1`, and model SHA-256 `9ba6a441bfd5c71a758f596e5f7b6edb74c0e16242c02a82064bfd55e52b96e7`. Its immutable [Ink GitHub Release](https://github.com/Devaretanmay/ink/releases/tag/ink-runtime-v0.6.0rc2.1) is built from Ink source revision `d64650562c0771f35c8b4b6e5cda1fdda534add8`. The 881,657,348-byte runtime ZIP has SHA-256 `98e3210587886cedcec8d9564591eeb5448e154ee794d850ea19a5d59bf03e97`; the exact URL and checksum are pinned in `apps/desktop/scripts/ink-runtime.json`. The artifact manifest records the matching runtime-manifest checksum and Inkway bridge source checksum.

The release archive contract is:

```text
ink-runtime-<artifact-version>-darwin-arm64/
  runtime/                 # Python, Ink SDK, pinned dependencies, model
  bridge/bridge.py         # exact Inkway bridge source, hash recorded
  manifest.json            # engine/model/protocol/platform/revision/checksums
```

The Ink repository now owns the release dependency lock and runtime assembly in `runtime/macos-arm64.lock` and `scripts/build-runtime-bundle.mjs`; `scripts/package-runtime-release.mjs` packages that verified output together with the exact Inkway bridge source and writes an archive SHA-256 sidecar. The builder requires a clean Ink source revision and verifies the trained checkpoint before packaging:

```sh
cd /path/to/ink
make runtime-release PLATFORM=darwin ARCH=arm64 VERSION=0.6.0rc2.1 \
  INKWAY_BRIDGE=/path/to/inkway/server/internal/ink/bridge.py
```

Then publish the generated ZIP and SHA sidecar as the asset for immutable release tag `ink-runtime-v0.6.0rc2.1` in `Devaretanmay/ink`. Update the Inkway pin with the exact downloaded asset URL and SHA-256 from the generated sidecar. Release `0.6.0rc2.1` follows that process. Inkway packaging fetches and validates it from an empty cache before staging.

## Build and verification

Once the pin contains a non-empty 64-character archive checksum and its matching immutable URL, the one-command desktop package path is:

```sh
make ink-runtime
pnpm --filter @inkway/desktop package -- --mac dmg zip --arm64
```

`make ink-runtime` downloads only the pinned URL, writes the verified archive cache, validates the extracted manifest and bundled bridge, and stages the runtime. It rejects a missing checksum, bad hash, path traversal, wrong engine/model/protocol/platform, missing dependencies/model/bridge, or bridge-source mismatch. Production packaging has no sibling-checkout/model-cache fallback. The target is currently macOS arm64 because the trained runtime uses MLX; no Intel, Windows, or Linux artifact is provided.

After publication, Inkway fetched the `0.6.0rc2.1` release asset from an empty cache, verified the archive SHA-256 and every compatibility/model/bridge check, and staged the runtime. The newly built, ad-hoc-signed Inkway arm64 DMG mounted and passed `TestBundledInkModelLifecycleAndPersistence` against its embedded runtime with provider credentials cleared and an isolated home: 1,621 independently verified outcomes, `OBSERVE → SHADOW → ACTIVE`, a genuine `source=fast_path` serve, persistence after bridge restart, and model inference returned `fresh_session` at confidence `0.5299`. Missing-model and incompatible-engine cases fail closed. This is controlled local integration evidence, not model-quality evidence.

The user runtime database remains under Inkway Application Support at `ink/decisions.db`, outside the app bundle. The model and runtime are immutable app resources. Missing, incompatible, or unverifiable Ink runtime keeps FastPath unavailable and uses the existing safe recovery fallback.

## Release synchronization

Ink SDK/model change → run Ink tests → stage the pinned runtime and trained model → generate release archive and checksums → publish a versioned Ink Release asset → update the exact Inkway artifact pin → fresh Inkway checkout downloads and verifies the asset → package app → run mounted-DMG model/FastPath/persistence proof → sign/notarize separately for public macOS distribution.

## Readiness

The canonical versioned runtime/model artifact is published and checksum-pinned, and the newly packaged mounted DMG passed the real SDK lifecycle/model proof. Release reproducibility is **not complete** because Inkway's packaging and bridge changes are still uncommitted in this working tree; a fresh Inkway checkout cannot yet see them, so a clean-checkout build has not been proven. CI fast checks are added; the real artifact job requires a self-hosted macOS arm64 runner and has not yet run. The local app is ad-hoc signed and not notarized, so public macOS distribution is not ready.

## DSH cleanup test race

The daemon-suite cleanup failure came from `TestStartDshProfileProvision_RunsAtMostOnce`: it returned when the fake DSH helper wrote its first invocation line, while the asynchronous provisioner was still writing the profile into `t.TempDir`. Test cleanup could remove that directory concurrently. The test now waits for the profile manifest and for `dshInstallInFlight` to clear before returning. The focused test passed 50 consecutive runs, and `go test ./internal/daemon -count=1` passed after the fix. Runtime/DSH product behavior was not changed.
