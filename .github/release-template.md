<!---
Inkway alpha release notes template. Copy into the GitHub Release body for
each `vX.Y.Z-alpha.N` tag. Replace every <placeholder> before publishing.

Versioning policy (maintainers):
- Inkway product versions keep semantic continuity with the 0.6.x series
  (e.g. v0.7.0-alpha.1). A clean 0.1.0-alpha.x restart was considered and
  rejected: version strings feed electron-updater channels, GoReleaser, and
  git-describe derivation, which all assume monotonic semver from tags.
- Inkway product version, Ink engine version, Ink runtime artifact version,
  and Ink model version are independent. Record all four in every release.
  Example: Inkway 0.7.0-alpha.1 / Ink engine 0.6.0rc2 / Ink runtime
  0.6.0rc2.1 / ink-decision-v1 1.0.0.
- Never ship names containing retired product codenames or a `-dirty` suffix.
- Never claim Apple notarization or Developer ID signing. The alpha is
  ad-hoc signed and distributed directly from this repository.
-->

# Inkway <version>

**Platform:** macOS Apple Silicon (arm64), macOS 26+

## What's included

- Inkway desktop (`Inkway.app`)
- Local Inkway backend + private PostgreSQL (bundled, no account required)
- Ink runtime <ink-runtime-version> (engine <ink-engine-version>)
- Local Ink decision model <ink-model> <ink-model-version>
- Inks: verified local decisions served when evidence supports them
- Local-first runtime with supported coding providers/tools (Claude Code, Codex, OpenCode; OpenAI/Anthropic/Groq Native API)

## Installation

1. Download the `Inkway-<version>-mac-arm64.dmg.part-*` files below (the bundle is split because GitHub caps single release files below 2 GiB).
2. Reassemble: `cat Inkway-<version>-mac-arm64.dmg.part-* > Inkway-<version>-mac-arm64.dmg`.
3. Open the DMG, drag Inkway to Applications, and open it.
4. If macOS reports the app cannot be verified: System Settings → Privacy
   & Security → Open Anyway → Open. Launch normally afterward.

Full steps: [docs/install-macos.md](https://github.com/Devaretanmay/inkway/blob/main/docs/install-macos.md).
Optional checksum verification with the published `SHA256SUMS` is described there.

## Security / trust

- **Ad-hoc signed. Not notarized.** No Apple Developer membership is used.
- Official builds come only from `github.com/Devaretanmay/inkway` releases.
- `SHA256SUMS` and `release-manifest.json` are published alongside the DMG/ZIP.
- Do not disable Gatekeeper. Approve only this app via Open Anyway.

## Known limitations

- macOS Apple Silicon only in this alpha.
- First launch may require the manual Open Anyway approval above.
- Local state lives outside the app bundle; back it up before upgrading.

## Validation

- [ ] Full agent test suite green (`scripts/test-go.sh --race`)
- [ ] Packaged Ink model proof (Ink runtime starts, local model loads, real model decision)
- [ ] Ink lifecycle / FastPath proof (lifecycle progresses, Ink/FastPath serves, state survives restart)
- [ ] Agent workflow proof from the DMG (provider → agent → issue → run → Review → Accept)
- [ ] Cancellation proof from the DMG (Stop ends CLI + detached children, no orphans)
- [ ] `SHA256SUMS` verifies; `codesign --verify --deep --strict` passes; DMG/ZIP integrity passes
