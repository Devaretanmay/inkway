import type { MetadataRoute } from "next";

/**
 * Public-site manifest. The task-management product is the local desktop app,
 * so installing this site opens the public download page rather than a hosted
 * workspace session.
 *
 * The icons under /icons are generated, not hand-drawn. To regenerate after a
 * brand change, edit public/icons/icon.svg and run from public/icons:
 *
 *   sips -s format png --resampleHeightWidth 512 512 icon.svg --out icon-maskable-512.png
 *   sips -s format png --resampleHeightWidth 180 180 icon.svg --out apple-touch-icon.png
 *   sips -s format png --resampleHeightWidth 512 512 ../../../desktop/build/icon.png --out icon-512.png
 *   sips -s format png --resampleHeightWidth 192 192 ../../../desktop/build/icon.png --out icon-192.png
 *
 * The two `any` icons come from the desktop app icon so an installed web app
 * and an installed desktop app show the same artwork; the maskable one is
 * full-bleed because Android crops it to the launcher's shape.
 */

/** Launch path. Exported so manifest.test.ts can run it through the proxy. */
export const PWA_START_URL = "/download";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Inkway",
    short_name: "Inkway",
    description:
      "Connect a coding tool, create an agent, assign an issue, and review the result.",
    start_url: PWA_START_URL,
    scope: "/",
    display: "standalone",
    // Splash-screen colours. The runtime status bar is driven by the
    // per-scheme `<meta name="theme-color">` pair in app/layout.tsx, which the
    // manifest cannot express — these are the pre-launch fallback only.
    background_color: "#FAF8F4",
    theme_color: "#FAF8F4",
    categories: ["productivity"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
