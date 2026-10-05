/**
 * Host rendered as the `<host>/<slug>` workspace URL prefix in the
 * create-workspace and onboarding UI. Derived from the deployment's app URL
 * (`daemon_app_url` from `/api/config`, surfaced through the config store).
 * Returns an empty string when the deployment has no app URL; callers then
 * show the slug without inventing a public host.
 */
export function workspaceUrlHost(
  daemonAppUrl: string | null | undefined,
): string {
  const trimmed = daemonAppUrl?.trim();
  if (!trimmed) return "";
  try {
    return new URL(trimmed).host;
  } catch {
    // `daemon_app_url` may arrive without a scheme; treat it as a bare host
    // and strip any path/query/fragment so only the authority remains.
    const bare = trimmed
      .replace(/^.*?:\/\//, "")
      .replace(/[/?#].*$/, "")
      .trim();
    return bare;
  }
}
