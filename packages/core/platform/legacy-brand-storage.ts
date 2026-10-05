const LEGACY_STORAGE_PREFIXES = ["multica:", "multica_", "multica-"];

/** Preserve existing browser state while moving its key namespace to Inkway. */
export function migrateLegacyBrandStorage(storage: Storage): number {
  let copied = 0;
  const entries: Array<[string, string]> = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key || !LEGACY_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
    const value = storage.getItem(key);
    if (value !== null) entries.push([key, value]);
  }
  for (const [legacyKey, value] of entries) {
    const key = `inkway${legacyKey.slice("multica".length)}`;
    if (storage.getItem(key) !== null) continue;
    storage.setItem(key, value);
    copied += 1;
  }
  return copied;
}
