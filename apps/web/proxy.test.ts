import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { INKWAY_LOCALE_HEADER } from "./lib/locale-routing";
import { config, proxy } from "./proxy";

function request(path: string) {
  return new NextRequest(`https://inkway.test${path}`);
}

describe("public web proxy", () => {
  it("does not redirect retired login, OAuth, or hosted-workspace paths", () => {
    for (const path of ["/login", "/signup", "/auth/callback", "/acme/issues"]) {
      expect(proxy(request(path)).headers.get("location")).toBeNull();
    }
  });

  it("forwards locale on public pages", () => {
    const req = request("/download");
    req.headers.set("accept-language", "fr-CA,fr;q=0.9");
    const response = proxy(req);
    expect(response.headers.get(`x-middleware-request-${INKWAY_LOCALE_HEADER}`)).toBe("fr");
  });

  it("retains only the configured docs and runtime rewrites", () => {
    expect(config.matcher).toContain("/docs/:path*");
    expect(config.matcher).not.toContain("/auth/:path*");
  });
});
