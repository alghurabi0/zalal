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
  /** Order details (N4). */
  order: (id: string) => `/orders/${id}`,
  /** Booking step 1 (§5.9): tanks, date and slot. */
  book: "/book",
  /** Booking step 2 (§5.10): photos, videos and a note. */
  bookPhotos: "/book/photos",
  /** Booking step 3 (§5.11): summary and payment. */
  bookConfirm: "/book/confirm",
  /** Booking success (N5). */
  booked: (id: string) => `/book/done/${id}`,
  chat: "/chat",
  profile: "/profile",
  /** POST only: ends the session, then Welcome. */
  logout: "/logout",
  terms: "/terms",
  privacy: "/privacy",
  /** Crew surface (spec §2, §8.1); a placeholder until Phase 3 task 2. */
  crew: "/crew",
  /** Admin dashboard (spec §8.2): Overview (A1). */
  admin: "/admin",
  /** Orders (A2), filtered by its query string (see adminOrdersQuery). */
  adminOrders: "/admin/orders",
  /** The order drawer opens over the orders list. */
  adminOrder: (id: string) => `/admin/orders?order=${encodeURIComponent(id)}`,
  /** The date × slot board (A2). */
  adminBoard: "/admin/orders/board",
  /** Prices (A8). */
  adminPrices: "/admin/prices",
  /** Schedule (A9): slots, blocked dates and orders that no longer fit. `?month=YYYY-MM`. */
  adminSchedule: "/admin/schedule",
  /** Settings (A13). */
  adminSettings: "/admin/settings",
  /** The service-area editor (A13). */
  adminServiceArea: "/admin/settings/area",
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
