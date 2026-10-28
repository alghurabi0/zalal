import { execFileSync } from "node:child_process";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "../../../src/lib/database.types";

// The local Supabase the app under test uses, with the secret key, for
// setting up data (roles, settings) that no screen can.

const status = JSON.parse(
  execFileSync("pnpm", ["exec", "supabase", "status", "-o", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }),
) as { API_URL: string; SECRET_KEY: string };

/** The local API's URL, which the app under test also uses (.env.local). */
export const SUPABASE_URL = status.API_URL;

export const admin = createClient<Database>(status.API_URL, status.SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
