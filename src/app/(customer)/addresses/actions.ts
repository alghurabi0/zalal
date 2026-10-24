"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { requireViewer } from "@/lib/auth/viewer";
import { HOME_ADDRESS_COOKIE } from "@/lib/cookies";
import { routes, safeNext } from "@/lib/routes";
import { addressIdSchema, addressInputSchema } from "@/lib/schemas/address";
import { createClient } from "@/lib/supabase/server";

// Location (spec §5.4) and the address picker (N2). Writes go through the
// user's own session, so RLS and the table's triggers decide: the service
// area check (SQLSTATE ZL001), one label per user (unique index, 23505) and
// one default address.

export type AddressFieldError =
  "district_short" | "district_long" | "landmark_short" | "landmark_long";

export type SaveAddressState = {
  error: "outside_area" | "label_taken" | "invalid" | "failed" | null;
  fields?: AddressFieldError[];
};

/** Location's "احفظ العنوان": adds an address, or edits one when `id` is set. */
export async function saveAddress(
  _prev: SaveAddressState,
  form: FormData,
): Promise<SaveAddressState> {
  const editing = form.get("id");
  const viewer = await requireViewer(
    typeof editing === "string" && editing !== "" ? routes.editAddress(editing) : routes.newAddress,
  );
  const parsed = addressInputSchema.safeParse({
    label: form.get("label"),
    district: form.get("district") ?? "",
    landmark: form.get("landmark") ?? "",
    lat: form.get("lat"),
    lng: form.get("lng"),
  });
  if (!parsed.success) {
    const fields = parsed.error.issues.flatMap((issue): AddressFieldError[] => {
      const field = issue.path[0];
      if (field !== "district" && field !== "landmark") return [];
      return [`${field}_${issue.message === "too_long" ? "long" : "short"}`];
    });
    return { error: "invalid", fields };
  }

  const supabase = await createClient();
  const id = form.get("id");
  let error: { code: string } | null;
  if (typeof id === "string" && id !== "") {
    const addressId = addressIdSchema.safeParse(id);
    if (!addressId.success) return { error: "failed" };
    const result = await supabase
      .from("addresses")
      .update(parsed.data)
      .eq("id", addressId.data)
      .select("id");
    error = result.error;
    if (!error && (result.data ?? []).length === 0) return { error: "failed" };
  } else {
    ({ error } = await supabase.from("addresses").insert({ ...parsed.data, user_id: viewer.id }));
  }

  if (error) {
    if (error.code === "ZL001") return { error: "outside_area" };
    if (error.code === "23505") return { error: "label_taken" };
    return { error: "failed" };
  }

  redirect(safeNext(form.get("next")) ?? routes.home);
}

export type AddressActionState = { error: "failed" | null };

/** N2 "حذف": soft delete through delete_address(), which also removes the address's tanks. */
export async function deleteAddress(id: string): Promise<AddressActionState> {
  await requireViewer(routes.profile);
  const addressId = addressIdSchema.safeParse(id);
  if (!addressId.success) return { error: "failed" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_address", { p_address_id: addressId.data });
  return { error: error ? "failed" : null };
}

/** N2 "خليه الأساسي": the trigger clears the old default. */
export async function makeDefaultAddress(id: string): Promise<AddressActionState> {
  await requireViewer(routes.profile);
  const addressId = addressIdSchema.safeParse(id);
  if (!addressId.success) return { error: "failed" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("addresses")
    .update({ is_default: true })
    .eq("id", addressId.data)
    .select("id");
  return { error: error || data.length === 0 ? "failed" : null };
}

/**
 * N2 on Home: which address Home shows. Kept per device in a cookie; Home
 * checks that it is still one of the user's live addresses and falls back
 * to the default.
 */
export async function selectHomeAddress(id: string): Promise<AddressActionState> {
  await requireViewer(routes.home);
  const addressId = addressIdSchema.safeParse(id);
  if (!addressId.success) return { error: "failed" };
  (await cookies()).set(HOME_ADDRESS_COOKIE, addressId.data, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return { error: null };
}
