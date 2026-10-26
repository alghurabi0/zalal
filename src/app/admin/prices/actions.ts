"use server";

import * as Sentry from "@sentry/nextjs";

import { type AdminEditResult, editFailure } from "@/lib/admin/edit-errors";
import { requireViewer } from "@/lib/auth/viewer";
import { routes } from "@/lib/routes";
import { type PricesInput, pricesSchema } from "@/lib/schemas/admin-catalog";
import { createClient } from "@/lib/supabase/server";

const report = (message: string) => Sentry.captureMessage(message, "error");

/** A8: saves the six prices at once (admin_update_prices; changed cells are audited). */
export async function savePrices(input: PricesInput): Promise<AdminEditResult> {
  await requireViewer(routes.adminPrices, "admin");
  const parsed = pricesSchema.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_update_prices", {
    p_prices: parsed.data.map((cell) => ({
      tank_type: cell.type,
      size: cell.size,
      price_iqd: cell.price,
    })),
  });
  return error ? editFailure("admin_update_prices", error, report) : { status: "done" };
}
