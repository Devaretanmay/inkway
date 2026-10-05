function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    removeItem: (key: string) => { values.delete(key); },
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

// Node's optional global localStorage and some jsdom versions expose an
// unusable partial implementation. Zustand persistence requires the full
// Storage contract in DOM-backed core tests.
if (typeof window !== "undefined") {
  const storage = globalThis.localStorage;
  if (
    typeof storage?.clear !== "function" ||
    typeof storage.getItem !== "function" ||
    typeof storage.setItem !== "function" ||
    typeof storage.removeItem !== "function"
  ) {
    const memoryStorage = createMemoryStorage();
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: memoryStorage });
    Object.defineProperty(window, "localStorage", { configurable: true, value: memoryStorage });
  }
}
