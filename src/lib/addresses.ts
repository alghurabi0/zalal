import "server-only";

import type { AddressSummary } from "@/app/(customer)/addresses/address-picker";
import { createClient } from "@/lib/supabase/server";

/**
 * The logged-in customer's live addresses for the picker (N2): the default
 * first, then newest. RLS returns only their own live rows.
 */
export async function listAddresses(): Promise<AddressSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("addresses")
    .select("id, label, district, landmark, is_default, created_at")
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Addresses read failed: ${error.message}`);
  return data.map((row) => ({
    id: row.id,
    label: row.label,
    district: row.district,
    landmark: row.landmark,
    isDefault: row.is_default,
  }));
}
