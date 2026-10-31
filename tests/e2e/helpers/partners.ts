import { newPhone } from "./auth";
import { admin } from "./supabase";

// Partner fixtures (spec §8.3 A22): a partner written directly, with a name of
// its own so parallel tests never read each other's rows. It holds no share:
// shares are set per month for every partner, so only admin-partners.spec.ts
// sets them.

export async function createPartner() {
  const name = `شريك ${newPhone().slice(-6)}`;
  const { data } = await admin
    .from("partners")
    .insert({ name })
    .select("id, name")
    .single()
    .throwOnError();
  return data;
}
