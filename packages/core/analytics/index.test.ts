import { describe, expect, it, vi } from "vitest";
import {
  captureEvent,
  captureException,
  identify,
  initAnalytics,
  resetAnalytics,
  setPersonProperties,
} from "./index";

describe("local-first analytics boundary", () => {
  it("never initializes a collector, even if inherited config is present", () => {
    expect(initAnalytics({ key: "obsolete", host: "https://telemetry.example" })).toBe(false);
  });

  it("discards events and exceptions without touching the network", () => {
    const captured = vi.fn();
    captureEvent("issue.created", {}, { onCaptured: captured });
    captureException(new Error("local failure"), {}, { onCaptured: captured });
    identify("local-owner");
    setPersonProperties({ name: "Local owner" });
    resetAnalytics();
    expect(captured).toHaveBeenCalledTimes(2);
  });
});
