import { describe, expect, it } from "vitest";
import { migrateLegacyBrandStorage } from "./legacy-brand-storage";

function storageFrom(entries: Record<string, string>): Storage {
  const values = new Map(Object.entries(entries));
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, String(value)),
  };
}

describe("Inkway local storage migration", () => {
  it("copies old namespaced state while preserving the source and new values", () => {
    const storage = storageFrom({
      multica_token: "session-token",
      "multica:chat:drafts": "draft-state",
      "multica_squads_view:acme": "view-state",
      "inkway_token": "new-token",
    });

    expect(migrateLegacyBrandStorage(storage)).toBe(3);
    expect(storage.getItem("inkway_token")).toBe("new-token");
    expect(storage.getItem("inkway:chat:drafts")).toBe("draft-state");
    expect(storage.getItem("inkway_squads_view:acme")).toBe("view-state");
    expect(storage.getItem("multica_token")).toBe("session-token");
    expect(migrateLegacyBrandStorage(storage)).toBe(0);
  });
});
