import { type ReactNode, Suspense } from "react";

import { getViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";

import { PushSync } from "@/components/notifications/push-sync";

import { LocationShare } from "./location-share";

/**
 * The crew app's frame. While any of the crew's jobs is on the way, the
 * phone shares its position from every crew screen, not only the job's own
 * page (spec §8.1 GPS rule). A status change refreshes the page, which
 * re-reads the jobs on the way here too.
 */
export default function CrewLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Suspense fallback={null}>
        <Sharing />
      </Suspense>
      <PushSync />
      {children}
    </>
  );
}

async function Sharing() {
  const viewer = await getViewer();
  if (viewer?.role !== "crew") return null;
  const supabase = await createClient();
  // RLS returns only orders assigned to this crew while it is active.
  const { data, error } = await supabase
    .from("orders")
    .select("id")
    .eq("status", "on_the_way")
    .order("id");
  if (error) throw new Error(`Jobs on the way read failed: ${error.message}`);
  const ids = data.map((order) => order.id);
  if (ids.length === 0) return null;
  return <LocationShare key={ids.join(",")} orderIds={ids} />;
}
