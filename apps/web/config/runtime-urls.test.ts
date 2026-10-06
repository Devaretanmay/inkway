// @vitest-environment node
import { describe, expect, it } from "vitest";
import { resolveDevDocsUrl, resolveDocsUrl, runtimeRewriteDestination } from "./runtime-urls";

describe("public docs upstream", () => {
  it("accepts an optional HTTP(S) docs origin", () => {
    expect(resolveDocsUrl({ DOCS_URL: " https://docs.example.test/ " })).toBe(
      "https://docs.example.test",
    );
    expect(resolveDocsUrl({ DOCS_URL: "file:///tmp/docs" })).toBeUndefined();
  });

  it("uses the conventional local docs service only in development", () => {
    expect(resolveDevDocsUrl({})).toBe("http://localhost:4000");
  });

  it("rewrites docs only and never proxies account or product APIs", () => {
    expect(runtimeRewriteDestination("/docs/agents", { DOCS_URL: "http://docs:4000" })).toBe(
      "http://docs:4000/docs/agents",
    );
    for (const path of ["/api/config", "/auth/send-code", "/ws", "/health"]) {
      expect(runtimeRewriteDestination(path, { REMOTE_API_URL: "https://api.multica.ai" })).toBeUndefined();
    }
  });
});
