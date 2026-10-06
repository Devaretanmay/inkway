import { describe, expect, it } from "vitest";
import manifest, { PWA_START_URL } from "./manifest";

describe("public-site manifest", () => {
  it("opens the public download page without hosted account navigation", () => {
    expect(PWA_START_URL).toBe("/download");
    expect(manifest().start_url).toBe("/download");
    expect(manifest().shortcuts).toBeUndefined();
  });
});
