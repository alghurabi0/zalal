/**
 * Customer app URLs. The spec fixes only "/" for the customer surface
 * (§2); the rest are decided here so links have one source.
 */
export const routes = {
  home: "/",
  welcome: "/welcome",
  login: "/login",
  /** OTP (§5.3). The phone being verified lives in a cookie, never the URL. */
  verify: "/login/verify",
  /** Name (N1), right after the first login. */
  name: "/onboarding/name",
  /** Location (§5.4) for a new address; `?onboarding=1` during onboarding. */
  newAddress: "/addresses/new",
  editAddress: (id: string) => `/addresses/${id}/edit`,
  /** My tanks (N3). */
  tanks: "/tanks",
  orders: "/orders",
  book: "/book",
  chat: "/chat",
  profile: "/profile",
  terms: "/terms",
  privacy: "/privacy",
  /** Crew and admin surfaces (spec §2); placeholders until Phase 3. */
  crew: "/crew",
  admin: "/admin",
} as const;

/**
 * Pages that need a login. proxy.ts sends a guest to Login with `next` set
 * to the page, and each page checks the session again on the server.
 * Prefix match on whole path segments.
 */
export const loginRequiredPrefixes = [
  "/onboarding",
  "/addresses",
  "/tanks",
  "/profile",
  "/orders",
  "/book",
  "/chat",
  "/crew",
  "/admin",
] as const;

export function requiresLogin(pathname: string): boolean {
  return loginRequiredPrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/** Adds `next` to a URL when there is somewhere to go back to. */
export function withNext(path: string, next: string | null | undefined): string {
  if (!next || next === routes.home) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}next=${encodeURIComponent(next)}`;
}

/**
 * Reads a `next` value from a query string or form and returns it only if it
 * is a path on this site. Anything else (another origin, `//host`, `/\host`,
 * control characters, the login pages themselves) gives null, so a link can't
 * send someone off-site after login.
 */
export function safeNext(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  // Control characters and backslashes: browsers treat "\" like "/".
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return null;
  let parsed: URL;
  try {
    parsed = new URL(value, "http://zalal.invalid");
  } catch {
    return null;
  }
  if (parsed.origin !== "http://zalal.invalid") return null;
  if (parsed.pathname === routes.login || parsed.pathname.startsWith(`${routes.login}/`)) {
    return null;
  }
  if (parsed.pathname === routes.welcome) return null;
  return `${parsed.pathname}${parsed.search}`;
}
