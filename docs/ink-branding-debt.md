# Inkway branding and compatibility

Inkway is the product shown in the normal app. These are the retained technical and historical identifiers; keep them out of user-facing product copy unless the detail is needed for setup or support.

Intentional internal compatibility references:

- `@inkway/*` package names, TS import aliases, workspace package identifiers, Go module/repository paths, and repository ownership remain stable for upgrades and source provenance.
- `INKWAY_*` environment names, database names/tables, migration identifiers, CLI config paths, cookies, request headers, and `inkway://` protocol remain stable because renaming them can strand existing installations or clients.
- The `Ink` desktop data directory remains in place so existing local settings, sessions, and secure credential references survive the product rename.
- Ink appears in its SDK, FastPath engine diagnostics, and technical proof documents only; it is the underlying Decision JIT, not another application.
- GitHub actions, updater endpoints, historical issue references, dependency names, and license notices identify the upstream source repository or project history.
- Retained legacy collaboration route names are internal compatibility where shared issue, assignment, notification, or authorization dependencies still use them. They are not part of the release-candidate navigation.

Do not rename these identifiers as cosmetic cleanup; migrate them only with explicit data and upgrade compatibility work. Historical release notes retain the product names and screenshots current when they were written.
