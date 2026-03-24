import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  url: "./comp_cache.db",
  schema: "./drizzle/schema.ts",
  out: "./drizzle",
});
