// Kept in sync with exported app constants by Vite, including defaults that have
// never been written to the settings store.
const modules = import.meta.glob<Record<string, unknown>>(
  ["../constants/*Settings.ts", "../constants/experimentalFeatures.ts", "!../constants/*.test.ts"],
  { eager: true }
);

export const settingsCatalog = Object.values(modules)
  .flatMap((module) =>
    Object.entries(module).flatMap(([symbol, key]) => {
      if (!symbol.endsWith("_KEY") || typeof key !== "string") return [];
      const stem = symbol.slice(0, -4);
      const defaultValue = module[`DEFAULT_${stem}`];
      const event = module[`${stem}_CHANGED_EVENT`] ?? module[`${stem}_EVENT`];
      return [
        {
          symbol,
          key,
          ...(defaultValue !== undefined ? { defaultValue } : {}),
          ...(typeof event === "string" ? { event } : {}),
        },
      ];
    })
  )
  .sort((a, b) => a.key.localeCompare(b.key));
