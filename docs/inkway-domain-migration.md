# Inkway domain migration checklist

Inkway currently uses the existing Multica service infrastructure. Keep it in service until the future Inkway-owned domains, certificates, callbacks, and deployments are verified. Do not change a host to a guessed Inkway domain.

## Current service inventory

| Surface | Current host or configuration | Cutover work |
|---|---|---|
| Public web and docs | `multica.ai`, `www.multica.ai` | Move web/docs DNS and canonical URLs after the replacement is verified. |
| API and WebSocket/realtime | `api.multica.ai`, `api-preview.multica.ai`, `api-staging.multica.ai`; realtime uses the API host with `/ws` | Move API and WebSocket routing together; test long-lived connections, auth, and health checks. |
| Desktop distribution and updates | `multica.ai/download` and release/update configuration in `.github/workflows/release.yml` and `apps/desktop/electron-builder.yml` | Publish update metadata and signed assets at the replacement endpoint before changing client defaults. |
| Static assets / CDN | `inkway-static.copilothub.ai`, `multica-static` deployment variables, and `static.multica.ai` configuration references | Provision bucket/CDN, origin access, cache rules, and invalidation before switching asset URLs. |
| Plugin API | `plugin-api.multica.ai` in the OpenAPI default; deployment may override `INKWAY_PLUGIN_API_URL` | Move versioned API host and plugin surface origin together; test external plugin clients. |
| Telemetry | `telemetry.multica.ai` | Provision endpoint and retention/monitoring before changing the client endpoint. |
| Auth and OAuth | API/web callback URLs plus provider console registrations; exact live callback URLs are deployment secrets/configuration | Inventory each provider registration and add replacement callbacks before removing old callbacks. Test sign-in, logout, and account linking. |
| Email | Existing Multica sender/domain configured in deployment secrets | Verify SPF, DKIM, DMARC, bounce handling, and deliverability for the Inkway domain before changing templates or sender identity. |
| CORS and cookies | Production origin allowlists and cookie-domain settings in deployment configuration | Add new web/API origins first. Preserve session continuity; change cookie domain only after cross-subdomain and logout tests. |
| Desktop defaults | `apps/desktop/src/shared/runtime-config.ts` currently defaults to the live Multica API/web hosts | Switch defaults only after the API, web, and realtime cutover is stable. Preserve environment overrides for self-hosting. |
| Mobile defaults | `apps/mobile/.env.production` points to `api.multica.ai` and `multica.ai`; staging config includes `multica-api.copilothub.ai` and `multica-app.copilothub.ai` | Update and release mobile clients after the replacement hosts are live. |

## Cutover sequence

1. Select and verify the Inkway-owned domains. Confirm registrar access, DNS ownership, and the final host map for web, API, realtime, static assets, plugin API, and telemetry.
2. Lower DNS TTLs and provision TLS certificates for every hostname. Verify renewal and origin routing before publishing the names.
3. Deploy web, API, WebSocket/realtime, static/CDN, plugin, and telemetry services behind the new hosts. Add the new web/API origins to CORS and add new auth/OAuth callbacks while old callbacks still work.
4. Configure email DNS and sender identity. Deliver and receive test messages and verify SPF, DKIM, DMARC, and bounce processing.
5. Add new host values to deployment variables and secrets. Do not put credentials or private deployment values in this document. Confirm health checks, dashboards, alerts, and logs identify both old and new hostnames during overlap.
6. Update desktop and mobile API/web defaults, OAuth redirects, callback allowlists, CORS, cookies, download links, updater metadata, and documentation in one release. Keep explicit environment overrides available.
7. Run login/logout, OAuth linking, issue/run APIs, uploads/downloads, realtime reconnect, email, plugin calls, desktop update checks, and mobile deep-link tests against the new hosts.
8. Shift DNS and traffic gradually. Monitor error rate, latency, auth failures, websocket disconnects, email delivery, update checks, and telemetry ingestion.
9. Keep old DNS, certificates, callbacks, and deployments available through the rollback window. Rollback by restoring previous host defaults and DNS weights; do not revoke old callbacks or certificates until the new path is stable.
10. After the agreed observation window, remove old callbacks, CORS entries, cookie scope, DNS records, certificates, deployment secrets, and monitoring only when logs confirm no supported clients still depend on them.

## Configuration guardrails

- Desktop: `VITE_API_URL` overrides the packaged `api.multica.ai` default; the web URL is derived from the API host unless configured by the existing runtime config.
- Web deployments: review `NEXT_PUBLIC_API_URL`, `REMOTE_API_URL`, `FRONTEND_ORIGIN`, `INKWAY_PUBLIC_URL`, and deployment-specific auth callback variables.
- Mobile: `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_WEB_URL` in `apps/mobile/.env.production` are committed production defaults; local `.local` overrides remain ignored.
- Server: review `INKWAY_PUBLIC_URL`, `INKWAY_APP_URL`, `INKWAY_DAEMON_SERVER_URL`, `INKWAY_PLUGIN_API_URL`, `INKWAY_PLUGIN_SURFACE_ORIGIN`, CORS origin settings, cookie-domain settings, and provider callback secrets.
- Release: review `apps/desktop/electron-builder.yml`, `apps/desktop/src/main/updater.ts`, release workflow configuration, download links, and `latest-mac.yml` publishing location.

No Inkway-owned production domain has been selected or verified yet. Existing Multica endpoints stay active until the owner completes the domain selection, DNS/TLS provisioning, provider-console updates, and deployment cutover.
