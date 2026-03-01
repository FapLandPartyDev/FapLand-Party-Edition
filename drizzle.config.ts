import { defineConfig } from "drizzle-kit";

export default defineConfig({
    schema: "./electron/services/db/schema.ts",
    out: "./drizzle",
    dialect: "sqlite",
});
