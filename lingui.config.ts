import { defineConfig } from "@lingui/cli";

export default defineConfig({
  sourceLocale: "en",
  locales: ["en", "de", "es", "fr", "zh"],
  catalogs: [
    {
      path: "src/locales/{locale}/messages",
      include: ["src"],
      exclude: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.spec.tsx"],
    },
  ],
  format: "po",
  // Explicit IDs can share text; sort by unique ID to keep extraction stable.
  orderBy: "messageId",
  compileNamespace: "es",
});
