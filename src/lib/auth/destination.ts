import type { Database } from "@/lib/database.types";
import { routes, safeNext, withNext } from "@/lib/routes";

type Role = Database["public"]["Enums"]["app_role"];

/**
 * Where a user goes after a correct code (spec §2, §5.3): crew and admins to
 * their surface; a new customer to Name (N1), then Location; a customer
 * without an address to Location; everyone else back to where they were
 * going, or Home.
 */
export function afterLogin(input: {
  role: Role;
  isNewUser: boolean;
  hasAddress: boolean;
  next: string | null;
}): string {
  if (input.role === "crew") return routes.crew;
  if (input.role === "admin") return routes.admin;
  const next = safeNext(input.next);
  if (input.isNewUser) return withNext(routes.name, next);
  if (!input.hasAddress) return onboardingLocation(next);
  return next ?? routes.home;
}

/** After Name (N1): Location if there's no address yet, else onward. */
export function afterName(input: { hasAddress: boolean; next: string | null }): string {
  const next = safeNext(input.next);
  if (!input.hasAddress) return onboardingLocation(next);
  return next ?? routes.home;
}

/** Location in onboarding mode, where "بعدين" replaces the back button. */
export function onboardingLocation(next: string | null): string {
  return withNext(`${routes.newAddress}?onboarding=1`, next);
}
