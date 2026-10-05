import { describe, expect, it } from "vitest";
import { packagedInkEnv } from "./ink-runtime";

describe("packaged Ink runtime environment", () => {
  it("uses only app resources for the engine/model and app support for state", () => {
    expect(
      packagedInkEnv("/Applications/Inkway.app/Contents/Resources", "/Users/test/Library/Application Support/Inkway", "1.2.3"),
    ).toEqual({
      INK_ENABLED: "true",
      INK_DISABLED: "false",
      INK_MODEL_DISABLED: "false",
      INK_DISABLE_FAST_PATH: "false",
      INK_AUTO_INSTALL: "0",
      INK_PYTHON: "/Applications/Inkway.app/Contents/Resources/ink/python/cpython-3.13.12-macos-aarch64-none/bin/python3.13",
      INK_SITE_PACKAGES: "/Applications/Inkway.app/Contents/Resources/ink/site-packages",
      INK_MODEL_DIR: "/Applications/Inkway.app/Contents/Resources/ink/model",
      INK_RUNTIME_MANIFEST: "/Applications/Inkway.app/Contents/Resources/ink/compatibility.json",
      INK_DB_PATH: "/Users/test/Library/Application Support/Inkway/ink/decisions.db",
      INK_INKWAY_VERSION: "1.2.3",
    });
  });
});
