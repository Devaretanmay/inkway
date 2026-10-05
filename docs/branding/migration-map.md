# Inkway / Ink rename and compatibility map

Created 2026-10-05 before edits; updated during implementation. Old names below are intentional migration inputs or immutable provenance, not current product identities.

## Naming

| Retired identity | Current identity | Classification |
|---|---|---|
| Issuway | Inkway | A — desktop/web product, package, user-facing text |
| Microloop | Ink | A — engine, Python SDK, runtime, bridge, state, model distribution |
| FastPaths | Inks | A — user-facing page, navigation, labels, and documentation |
| `fast_path` / `/fastpaths` | retained internally | B — persisted decision source/API; old UI route redirects to `/inks` |

## A — must rename

Active owned source, package scopes, CLI, Go module path, Python distribution/import, app metadata, runtime packaging names, model logical identity, active documentation, app-support directory, primary UI routes, and repository directory names are being changed to Inkway / Ink / Inks. The installed application ID is `io.github.devaretanmay.inkway`; this uses the existing GitHub owner namespace rather than an unverified product domain.

## B — migrate with backward compatibility

- Desktop user data: copy the first available legacy app-data folder to `Inkway` atomically; verify the copied tree; leave the source intact. Candidates cover Microloop, Issuway, Multica, and suffixed development folders.
- Ink SQLite state: copy the previous `microloop/decisions.db` into the new `ink/decisions.db` using SQLite backup and integrity checks; keep the source. Migration is idempotent.
- Model cache: copy the old Microloop cache/checkpoint to the Ink cache, verify model bytes, and write Ink metadata; do not rewrite weights.
- Provider credentials: read legacy Keychain service names, write and verify the Inkway service, retain the old entries. Disconnect removes both namespaces.
- Browser state and CSRF: copy old `multica*` storage keys without overwriting Inkway keys; accept old CSRF cookies while sessions age out.
- URL schemes and CLI executable lookup: keep old schemes/executable names only as upgrade compatibility inputs.
- `/fastpaths` bookmarks redirect to `/inks`; API `/api/workspaces/{id}/fastpaths`, payload names, `DecisionSite`, and persisted source enum remain stable. A separate additive API migration is not required for a UI rename.
- Existing SQL migration contents and migration IDs are immutable. New schema changes use a later forward migration; migration comments and runtime references can mention old identifiers when needed to explain historical state.
- `channel_user_binding.multica_user_id` is renamed in place to `inkway_user_id` by migration 566. The old migration stays unchanged; the rename preserves stored bindings and indexes, and its down migration restores the previous column name.
- The transaction-local setting `multica.workspace_teardown` is renamed to `inkway.workspace_teardown` in application code; migration 567 recreates the active task-usage and search-index guards against the new setting. Earlier trigger migrations remain immutable and the down migration restores their prior conditions.

## C — historical / immutable

- Published `ink-runtime-v0.6.0rc2.1` is Inkway's active pinned runtime (`ink-decision-v1`, engine `0.6.0rc2`, artifact SHA-256 `98e3210587886cedcec8d9564591eeb5448e154ee794d850ea19a5d59bf03e97`). The earlier `microloop-runtime-v0.6.0rc1.1` release, its checksums, release/tag history, and old benchmark/pilot/evidence records remain immutable provenance and migration inputs.
- Existing pre-rebrand screenshots and the completed Issuway alpha report are moved under `artifacts/archive/pre-inkway/`; they are not current product screenshots.
- Existing Git history and already-shipped database migrations are not rewritten.

## D — third-party or operational identity

- Provider, local CLI, generic networking (`multicast`), and upstream model/license names remain unchanged.
- `multica.ai` and `multica-*.copilothub.ai` are existing service/DNS endpoints embedded in deployments. No verified Inkway domain was supplied. Keep them operational until DNS, certificates, email, and cloud routing are migrated; never substitute an invented domain. These hostnames are explicitly excluded from the retired-product-name scan. This is an infrastructure migration, not user-facing product branding.
- Vendored license and attribution notices retain upstream/provenance facts; product copy and package metadata do not.

## Repository and release state

- Product origin is `multica-ai/multica`; moving it to `Devaretanmay/inkway` is an ownership transfer, not a rename. Do not create a duplicate. Complete the transfer only with destination-owner permission, then update remotes.
- Engine origin is `Devaretanmay/microloop`; this can be renamed in place to `Devaretanmay/ink` after local source, package, runtime, and clean-checkout checks pass.
- Local directories become `Agent/inkway` and `Agent/ink` after all commands using the old paths finish.
- Inkway must pin a newly built and published Ink runtime. The old release is not an active dependency. Final package hash and mounted-DMG model/lifecycle proof must be regenerated for that artifact.
