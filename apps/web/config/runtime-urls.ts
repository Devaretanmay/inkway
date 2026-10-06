type RuntimeEnv = Record<string, string | undefined>;

export function resolveDocsUrl(env: RuntimeEnv): string | undefined {
  const value = env.DOCS_URL?.trim();
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString().replace(/\/+$/, "")
      : undefined;
  } catch {
    return undefined;
  }
}

export function resolveDevDocsUrl(env: RuntimeEnv): string {
  return resolveDocsUrl(env) ?? "http://localhost:4000";
}

export function runtimeRewriteDestination(
  pathname: string,
  env: RuntimeEnv,
): string | undefined {
  const docsUrl = resolveDocsUrl(env);
  if (!docsUrl) return undefined;
  if (pathname === "/docs") return `${docsUrl}/docs`;
  if (pathname.startsWith("/docs/")) return `${docsUrl}${pathname}`;
  return undefined;
}
