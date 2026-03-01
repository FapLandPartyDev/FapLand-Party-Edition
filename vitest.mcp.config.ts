import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["electron/mcp/**/*.test.ts", "src/mcp/**/*.test.ts"],
  },
});
