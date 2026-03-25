import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  url: "./src/comp_cache.db",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
