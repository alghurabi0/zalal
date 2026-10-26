// The media-cleanup Edge Function (spec §7 Storage); the work is in
// cleanup.ts. verify_jwt is off (supabase/config.toml): pg_cron's call
// carries the job's own secret, which handleRequest checks.
import { handleRequest, serviceKeyFrom } from "./cleanup.ts";

Deno.serve((req) =>
  handleRequest(req, {
    secret: Deno.env.get("MEDIA_CLEANUP_SECRET"),
    url: Deno.env.get("SUPABASE_URL"),
    serviceKey: serviceKeyFrom(
      Deno.env.get("SUPABASE_SECRET_KEYS"),
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    ),
  }),
);
