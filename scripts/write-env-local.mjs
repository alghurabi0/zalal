// Writes .env.local from the running local Supabase (`supabase status`), so
// the app talks to it. Those keys are throwaway, local-only defaults. Used by
// the cloud SessionStart hook and by CI. Keeps an existing .env.local unless
// --force is passed.
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";

const path = ".env.local";

if (existsSync(path) && !process.argv.includes("--force")) {
  console.log(`${path} exists; leaving it as is.`);
  process.exit(0);
}

const status = JSON.parse(
  execFileSync("pnpm", ["exec", "supabase", "status", "-o", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }),
);

writeFileSync(
  path,
  `NEXT_PUBLIC_SUPABASE_URL=${status.API_URL}\n` +
    `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${status.PUBLISHABLE_KEY}\n` +
    `SUPABASE_SECRET_KEY=${status.SECRET_KEY}\n`,
);
console.log(`Wrote ${path} from local Supabase.`);
