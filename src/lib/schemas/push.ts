import { z } from "zod";

// A browser's push subscription as save_push_subscription takes it (spec
// §9.2). The database checks the endpoint's host too.

export const pushSubscriptionSchema = z.object({
  endpoint: z.url().startsWith("https://").max(1000),
  p256dh: z.string().regex(/^B[A-Za-z0-9_-]{86}$/),
  auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
});

export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;
