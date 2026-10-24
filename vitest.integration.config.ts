import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Tests against the running local Supabase (`pnpm db:start`): real SQL
// functions, Auth and its admin API. Run with `pnpm test:integration`.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    // One file at a time: they share the database.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
