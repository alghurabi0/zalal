"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireViewer } from "@/lib/auth/viewer";
import { routes } from "@/lib/routes";
import { nameInputSchema } from "@/lib/schemas/profile";
import { createClient } from "@/lib/supabase/server";

export type EditNameState = {
  error: "too_short" | "too_long" | "failed" | null;
  /** What was typed, so the field keeps it after an error. */
  value?: string;
};

/** Edit profile (N10): saves full_name as the user (RLS, N1's rules), then back to Profile. */
export async function saveProfileName(
  _prev: EditNameState,
  form: FormData,
): Promise<EditNameState> {
  const viewer = await requireViewer(routes.editProfile);
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

  revalidatePath(routes.profile);
  redirect(routes.profile);
}
