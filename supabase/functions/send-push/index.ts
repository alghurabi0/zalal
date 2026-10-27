// The send-push Edge Function (spec §9.2); the work is in push.ts.
// verify_jwt is off (supabase/config.toml): pg_net's call carries the
// secret, which handleRequest checks.
import { serviceKeyFrom } from "../_shared/edge.ts";
import { handleRequest } from "./push.ts";

Deno.serve((req) =>
  handleRequest(req, {
    secret: Deno.env.get("SEND_PUSH_SECRET"),
    url: Deno.env.get("SUPABASE_URL"),
    serviceKey: serviceKeyFrom(
      Deno.env.get("SUPABASE_SECRET_KEYS"),
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    ),
    vapidPublicKey: Deno.env.get("VAPID_PUBLIC_KEY"),
    vapidPrivateKey: Deno.env.get("VAPID_PRIVATE_KEY"),
    vapidSubject: Deno.env.get("VAPID_SUBJECT"),
  }),
);
