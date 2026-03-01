import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./electron/services/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "file:dev.db",
  },
});
