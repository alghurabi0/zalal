import "server-only";

import { createClient } from "@/lib/supabase/server";

import { OVERVIEW_COLUMNS, type Subscription, toSubscription } from "./state";

export type SubscriptionPlan = {
  /** Null while the owner hasn't set a price: the plan isn't offered yet. */
  priceIqd: number | null;
  visits: number;
  tanks: number;
  cleaningIntervalMonths: number;
};

/** The plan from settings (A13), for N8; everyone reads settings, guests too. */
export async function subscriptionPlan(): Promise<SubscriptionPlan> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("settings")
    .select(
      "subscription_price_iqd, subscription_visits, subscription_tanks, cleaning_interval_months",
    )
    .single();
  if (error) throw new Error(`Settings read failed: ${error.message}`);
  return {
    priceIqd: data.subscription_price_iqd,
    visits: data.subscription_visits,
    tanks: data.subscription_tanks,
    cleaningIntervalMonths: data.cleaning_interval_months,
  };
}

/**
 * The logged-in customer's subscriptions, every address, newest first. RLS
 * returns only their own (admins: pass a userId to read one customer's).
 */
export async function listSubscriptions(userId?: string): Promise<Subscription[]> {
  const supabase = await createClient();
  let query = supabase
    .from("subscription_overview")
    .select(OVERVIEW_COLUMNS)
    .order("requested_at", { ascending: false });
  if (userId) query = query.eq("user_id", userId);
  const { data, error } = await query;
  if (error) throw new Error(`Subscriptions read failed: ${error.message}`);
  return data.map(toSubscription);
}
