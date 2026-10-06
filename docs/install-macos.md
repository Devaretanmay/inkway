# Install Inkway on macOS

## Requirements

- Apple Silicon Mac (arm64).
- macOS 26 or later. The bundled Ink MLX runtime requires macOS 26.
- No Inkway account required. Coding providers use their own credentials and may have their own charges.

## Install

1. Download the DMG parts from the official [Inkway GitHub Releases](https://github.com/Devaretanmay/inkway/releases). The bundle is large, so GitHub hosts it as split parts (`Inkway-<version>-mac-arm64.dmg.part-00`, `.part-01`, …) — download them all into one folder.
2. Reassemble the DMG in Terminal (replace `<version>`; all parts must be present):

```sh
cat Inkway-<version>-mac-arm64.dmg.part-* > Inkway-<version>-mac-arm64.dmg
```

3. Open the DMG.
4. Drag **Inkway** to **Applications**.
5. Open Inkway from Applications.
6. If macOS blocks the app because its developer cannot be verified, open **System Settings → Privacy & Security**, locate the Inkway message, click **Open Anyway**, then confirm **Open**. macOS may ask you to authenticate. Try opening Inkway again if the message is no longer shown.
7. Launch Inkway normally afterward. You can eject the DMG.

Inkway alpha is currently distributed directly and is not Apple-notarized.

**Ad-hoc signed. Not notarized.** macOS may require manual approval on first launch. Download only from [github.com/Devaretanmay/inkway](https://github.com/Devaretanmay/inkway). The approval applies to this app; do not disable system security. See [Apple's explanation of opening unnotarized apps](https://support.apple.com/en-us/102445).

The ZIP is an alternative: extract it, move Inkway.app to Applications, and follow the same first-launch steps. No developer tools are required to install the app. Inkway bundles its local backend, database, and Ink runtime/model; select and connect a supported coding provider in the app.

## Optional checksum verification

Download `SHA256SUMS` from the same release. In Terminal, change to the download folder.

If you downloaded split parts, verify the parts first, then the reassembled file (replace `<version>`; the expected hashes are in `SHA256SUMS` and `release-manifest.json`):

```sh
shasum -a 256 -c SHA256SUMS
shasum -a 256 Inkway-<version>-mac-arm64.dmg
```

`shasum -c` must report `OK` for every `.part-*` line, and the reassembled DMG hash must equal `dmg_sha256` in `release-manifest.json` (the `# whole-file` comment in `SHA256SUMS` carries the same value). Compare all 64 hexadecimal characters. If you downloaded both the DMG and ZIP parts, the same applies to the ZIP against `zip_sha256`. Checksums establish that the bytes match the published files, not Apple notarization.

## Updates and source builds

For this alpha, quit Inkway and replace the app with a newer release from the same official source. Your local state is stored outside the application bundle. Keep a backup before alpha upgrades.

Developers can use the separate [source setup instructions](../README.md#develop-inkway).
