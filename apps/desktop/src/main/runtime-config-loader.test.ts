// @vitest-environment node
import { describe, expect, it } from "vitest";
import { loadRuntimeConfig } from "./runtime-config-loader";

describe("loadRuntimeConfig", () => {
  it("uses dev env in electron-vite development", async () => {
    await expect(
      loadRuntimeConfig({
        isDev: true,
        env: {
          apiUrl: "http://localhost:8080",
          wsUrl: "ws://localhost:8080/ws",
          appUrl: "http://localhost:3000",
        },
      }),
    ).resolves.toEqual({
      ok: true,
      config: {
        schemaVersion: 1,
        apiUrl: "http://localhost:8080",
        wsUrl: "ws://localhost:8080/ws",
        appUrl: "http://localhost:3000",
      },
    });
  });

  it("uses only loopback endpoints in packaged desktop regardless of environment", async () => {
    await expect(
      loadRuntimeConfig({
        isDev: false,
        env: {
          apiUrl: "https://api.example.com",
          wsUrl: "wss://api.example.com/ws",
          appUrl: "https://example.com",
        },
      }),
    ).resolves.toEqual({
      ok: true,
      config: {
        schemaVersion: 1,
        apiUrl: "http://127.0.0.1:8080",
        wsUrl: "ws://127.0.0.1:8080/ws",
        appUrl: "http://127.0.0.1:8080",
      },
    });
  });
});
