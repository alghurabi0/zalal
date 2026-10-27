import { z } from "zod";

// Helpers every Edge Function shares. Plain TypeScript with no Deno APIs, so
// tsc, ESLint and Vitest check it; the deploy skips folders starting with _.

/**
 * Reads the service key the platform gives Edge Functions: the new secret
 * keys (a JSON map, key "default"), or the legacy service_role key.
 */
export function serviceKeyFrom(secretKeys: string | undefined, legacyKey: string | undefined) {
  if (secretKeys) {
    try {
      const parsed = z.record(z.string(), z.string()).safeParse(JSON.parse(secretKeys));
      if (parsed.success && parsed.data.default) return parsed.data.default;
    } catch {
      // Not JSON: fall back to the legacy key.
    }
  }
  return legacyKey || undefined;
}

/** Compares two strings in time that doesn't depend on where they differ. */
export async function sameSecret(given: string, expected: string) {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all(
    [given, expected].map(
      async (value) => new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))),
    ),
  );
  let diff = 0;
  for (let i = 0; i < a!.length; i++) diff |= a![i]! ^ b![i]!;
  return diff === 0;
}

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
