/**
 * Customer app URLs. The spec fixes only "/" for the customer surface
 * (§2); the rest are decided here so links have one source.
 * `/` is Home; until Home exists (Phase 1), next.config.ts redirects it to
 * Welcome.
 */
export const routes = {
  home: "/",
  welcome: "/welcome",
  login: "/login",
  orders: "/orders",
  book: "/book",
  chat: "/chat",
  profile: "/profile",
} as const;
