import { Suspense } from "react";

import { type Tab, TabBar } from "@/components/ui/tab-bar";
import { getViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";

import { LiveTabBar } from "./live-tab-bar";

/**
 * The customer tab bar with the chat unread dot (spec §5.18). Guests and
 * other roles get the plain bar.
 */
export function CustomerTabBar({ active }: { active: Tab }) {
  return (
    <Suspense fallback={<TabBar active={active} />}>
      <WithUnread active={active} />
    </Suspense>
  );
}

async function WithUnread({ active }: { active: Tab }) {
  const viewer = await getViewer();
  if (!viewer || viewer.role !== "customer") return <TabBar active={active} />;
  const supabase = await createClient();
  const { data } = await supabase
    .from("chat_threads")
    .select("customer_unread")
    .eq("user_id", viewer.id)
    .maybeSingle();
  return (
    <LiveTabBar active={active} userId={viewer.id} unread={(data?.customer_unread ?? 0) > 0} />
  );
}
