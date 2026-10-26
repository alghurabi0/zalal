"use client";

import { useState } from "react";

import { type Tab, TabBar } from "@/components/ui/tab-bar";
import { createClient } from "@/lib/supabase/browser";
import { usePostgresChanges } from "@/lib/supabase/use-postgres-changes";

/**
 * The tab bar with المحادثة's unread dot kept live (spec §5.16, §5.18): the
 * customer's thread row carries the count of support's and the system's
 * messages they haven't read. RLS sends only their own row.
 */
export function LiveTabBar({
  active,
  userId,
  unread: initial,
}: {
  active: Tab;
  userId: string;
  unread: boolean;
}) {
  const [unread, setUnread] = useState(initial);
  // A fresh server read wins (React's pattern for state derived from props).
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setUnread(initial);
  }

  usePostgresChanges({
    table: "chat_threads",
    filter: `user_id=eq.${userId}`,
    events: ["INSERT", "UPDATE"],
    onChange: (row) => setUnread(Number(row.customer_unread) > 0),
    // A change before the subscription was live: read the row again.
    onSubscribed: () => {
      void createClient()
        .from("chat_threads")
        .select("customer_unread")
        .eq("user_id", userId)
        .maybeSingle()
        .then(({ data }) => {
          if (data) setUnread(data.customer_unread > 0);
        });
    },
  });

  return <TabBar active={active} chatUnread={unread} />;
}
