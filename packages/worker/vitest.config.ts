import path from "node:path";
import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(__dirname, "migrations"));
  return {
    plugins: [
      // Storage isolation is per test FILE (writes persist across `it` blocks in a
      // file, then roll back at file end). There is no per-test rollback, so DB tests
      // must be collision-free within a file. `singleWorker`/`isolatedStorage` were
      // removed in pool-workers 0.16.
      cloudflareTest({
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations },
        },
      }),
    ],
    test: {
      setupFiles: ["./test/apply-migrations.ts"],
    },
  };
});
