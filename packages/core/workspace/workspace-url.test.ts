import { describe, expect, it } from "vitest";
import { workspaceUrlHost } from "./workspace-url";

describe("workspaceUrlHost", () => {
  it("returns the host of a full app URL", () => {
    expect(workspaceUrlHost("https://inkway.example.com")).toBe(
      "inkway.example.com",
    );
  });

  it("ignores scheme, path, and trailing slash", () => {
    expect(workspaceUrlHost("https://inkway.example.com/")).toBe(
      "inkway.example.com",
    );
    expect(workspaceUrlHost("http://inkway.example.com/app/onboarding")).toBe(
      "inkway.example.com",
    );
  });

  it("preserves a non-default port", () => {
    expect(workspaceUrlHost("https://my.host:3000")).toBe("my.host:3000");
  });

  it("accepts a bare host without a scheme", () => {
    expect(workspaceUrlHost("inkway.example.com")).toBe("inkway.example.com");
    expect(workspaceUrlHost("inkway.example.com/path")).toBe(
      "inkway.example.com",
    );
  });

  it("does not invent a public host when no app URL is configured", () => {
    expect(workspaceUrlHost("")).toBe("");
    expect(workspaceUrlHost("   ")).toBe("");
    expect(workspaceUrlHost(null)).toBe("");
    expect(workspaceUrlHost(undefined)).toBe("");
  });
});
