"use server";

import { redirect } from "next/navigation";

import { afterName } from "@/lib/auth/destination";
import { requireViewer } from "@/lib/auth/viewer";
import { routes } from "@/lib/routes";
import { nameInputSchema } from "@/lib/schemas/profile";
import { createClient } from "@/lib/supabase/server";

export type SaveNameState = {
  error: "too_short" | "too_long" | "failed" | null;
  /** What was typed, so the field keeps it after an error. */
  value?: string;
};

/** Name (N1): saves full_name as the user (RLS), then onward to Location or `next`. */
export async function saveName(_prev: SaveNameState, form: FormData): Promise<SaveNameState> {
  const viewer = await requireViewer(routes.name);
  const value = form.get("fullName")?.toString() ?? "";
  const parsed = nameInputSchema.safeParse({ fullName: value });
  if (!parsed.success) {
    const tooLong = parsed.error.issues[0]?.message === "too_long";
    return { error: tooLong ? "too_long" : "too_short", value };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ full_name: parsed.data.fullName })
    .eq("id", viewer.id);
  if (error) return { error: "failed", value };

  const { count, error: countError } = await supabase
    .from("addresses")
    .select("id", { count: "exact", head: true });
  if (countError) return { error: "failed", value };

  redirect(afterName({ hasAddress: (count ?? 0) > 0, next: form.get("next")?.toString() ?? null }));
}
