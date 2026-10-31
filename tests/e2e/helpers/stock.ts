import { newPhone } from "./auth";
import { admin } from "./supabase";

// Stock fixtures (spec §8.3 A23): an item written directly, with a name of its
// own so parallel tests never read each other's rows. It starts with no
// records; A19's low-stock card lists only low items, so a test checks only
// its own.

export async function createStockItem({ minQuantity = 0 }: { minQuantity?: number } = {}) {
  const name = `مادة ${newPhone().slice(-6)}`;
  const { data } = await admin
    .from("stock_items")
    .insert({ name, unit: "قطعة", min_quantity: minQuantity })
    .select("id, name")
    .single()
    .throwOnError();
  return data;
}
