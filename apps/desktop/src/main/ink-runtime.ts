import { join } from "path";

export function packagedInkEnv(
  resourcesPath: string,
  applicationSupportPath: string,
  appVersion: string,
): NodeJS.ProcessEnv {
  const root = join(resourcesPath, "ink");
  return {
    INK_ENABLED: "true",
    INK_DISABLED: "false",
    INK_MODEL_DISABLED: "false",
    INK_DISABLE_FAST_PATH: "false",
    INK_AUTO_INSTALL: "0",
    INK_PYTHON: join(
      root,
      "python",
      "cpython-3.13.12-macos-aarch64-none",
      "bin",
      "python3.13",
    ),
    INK_SITE_PACKAGES: join(root, "site-packages"),
    INK_MODEL_DIR: join(root, "model"),
    INK_RUNTIME_MANIFEST: join(root, "compatibility.json"),
    INK_DB_PATH: join(applicationSupportPath, "ink", "decisions.db"),
    INK_INKWAY_VERSION: appVersion,
  };
}
