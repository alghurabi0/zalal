"use server";

import { z } from "zod";

import { requireViewer } from "@/lib/auth/viewer";
import { routes } from "@/lib/routes";
import { tankInputSchema } from "@/lib/schemas/tank";
import { createClient } from "@/lib/supabase/server";

// My tanks (N3). Writes go through the user's own session: RLS allows a
// customer to add tanks only to their own live addresses, and the
// (address_id, user_id) foreign key backs that up. last_cleaned_at is never
// written here (spec §6: only order completion sets it).

export type SaveTankState =
  { status: "idle" | "saved" } | { status: "error"; error: "nickname_long" | "failed" };

/** Adds a tank, or edits one when `id` is set. */
export async function saveTank(_prev: SaveTankState, form: FormData): Promise<SaveTankState> {
  const viewer = await requireViewer(routes.tanks);
  const parsed = tankInputSchema.safeParse({
    addressId: form.get("addressId"),
    type: form.get("type"),
    size: form.get("size"),
    nickname: form.get("nickname") ?? undefined,
  });
  if (!parsed.success) {
    const nicknameLong = parsed.error.issues.some((issue) => issue.path[0] === "nickname");
    return { status: "error", error: nicknameLong ? "nickname_long" : "failed" };
  }
  const { addressId, type, size, nickname } = parsed.data;

  const supabase = await createClient();
  const id = z.uuid().safeParse(form.get("id"));
  if (id.success) {
    // A tank stays on its address; only type, size and nickname change.
    const { data, error } = await supabase
      .from("tanks")
      .update({ type, size, nickname })
      .eq("id", id.data)
      .select("id");
    if (error || (data ?? []).length === 0) return { status: "error", error: "failed" };
  } else {
    const { error } = await supabase
      .from("tanks")
      .insert({ user_id: viewer.id, address_id: addressId, type, size, nickname });
    if (error) return { status: "error", error: "failed" };
  }
  return { status: "saved" };
}

export async function deleteTank(id: string): Promise<{ error: "failed" | null }> {
  await requireViewer(routes.tanks);
  const tankId = z.uuid().safeParse(id);
  if (!tankId.success) return { error: "failed" };
  const supabase = await createClient();
  const { data, error } = await supabase.from("tanks").delete().eq("id", tankId.data).select("id");
  return { error: error || (data ?? []).length === 0 ? "failed" : null };
}
