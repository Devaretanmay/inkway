import type { WebPreferences } from "electron";

/**
 * WebPreferences shared by every renderer window — the tabbed main window and
 * the dedicated issue windows.
 *
 * Extracted from index.ts so the security-relevant flags are pinned by a unit
 * test beside this file: a silent regression here re-opens the renderer attack
 * surface, and the entry module cannot be imported in tests (it registers app
 * lifecycle handlers on import).
 *
 * `preloadPath` is injected rather than derived from `__dirname` here to keep
 * this a pure function — the bundled main process resolves it relative to its
 * own output directory at the call sites.
 */
export function createRendererWebPreferences(
  preloadPath: string,
  systemLocale: string,
  additionalArguments: string[] = [],
): WebPreferences {
  return {
    preload: preloadPath,
    // Sandboxed preload. The preload script only uses sandbox-safe APIs: the
    // `electron` module (contextBridge, ipcRenderer — including sendSync) and
    // the polyfilled `process` (platform, argv). It therefore must remain a
    // single CJS bundle, because the sandboxed preload `require` can only load
    // `electron` plus a couple of node builtins — see electron.vite.config.ts,
    // which bundles @electron-toolkit/preload into the output instead of
    // leaving it external.
    sandbox: true,
    // The local backend allows the packaged file:// renderer's serialized
    // null origin. Keep Chromium's origin and mixed-content checks enabled.
    webSecurity: true,
    // Required for the Chromium PDF viewer (PDFium) to activate inside
    // iframes — used by the attachment preview modal for application/pdf
    // files. Default is false in Electron; without it <iframe src=*.pdf>
    // renders blank.
    //
    // Security trade-off:
    //   1. The only PDFs that reach an iframe here are signed storage URLs
    //      issued by the local backend; user-supplied URLs
    //      are routed through `setWindowOpenHandler` → `openExternalSafely` and
    //      cannot land in this renderer.
    //   3. Chromium's PDFium plugin is itself sandboxed inside its own process
    //      and only handles the `application/pdf` MIME.
    //
    // If this permission becomes unnecessary, remove it to keep the main
    // renderer plugin-free.
    plugins: true,
    additionalArguments: [
      `--inkway-locale=${systemLocale}`,
      ...additionalArguments,
    ],
  };
}
