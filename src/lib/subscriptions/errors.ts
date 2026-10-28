// request_subscription()'s error codes (supabase/CLAUDE.md) as N8 shows them.

export type RequestSubscriptionError =
  /** ZL035: the address has a request, or a subscription running for more than 30 days. */
  | "exists"
  /** ZL037: the plan has no price yet. */
  | "notOffered"
  /** ZL001: the address is outside the service area. */
  | "outsideArea"
  /** P0002: the address was deleted meanwhile. */
  | "stale"
  | "failed";

const byCode: Record<string, RequestSubscriptionError> = {
  ZL035: "exists",
  ZL037: "notOffered",
  ZL001: "outsideArea",
  P0002: "stale",
};

export function requestSubscriptionErrorFor(code: string | undefined): RequestSubscriptionError {
  return (code && byCode[code]) || "failed";
}

/** ZL034's reasons (create_order, transition_order, A2), in its message. */
export const SUBSCRIPTION_REASONS = [
  "no_subscription",
  "outside_subscription_period",
  "no_visits_left",
  "subscription_tanks_exceeded",
] as const;

export type SubscriptionReason = (typeof SUBSCRIPTION_REASONS)[number];

/** ZL034's message as its reason; anything else reads as no_subscription. */
export function subscriptionReasonFor(message: string | undefined): SubscriptionReason {
  return SUBSCRIPTION_REASONS.find((reason) => reason === message) ?? "no_subscription";
}
