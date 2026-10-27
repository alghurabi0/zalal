"use client";

import { Bell } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";

import { IconButton } from "@/components/ui/icon-button";
import { routes } from "@/lib/routes";
import { createClient } from "@/lib/supabase/browser";
import { usePostgresChanges } from "@/lib/supabase/use-postgres-changes";

/**
 * Home's bell (Home.dc.html, spec §5.5): opens Notifications, with the
 * amber dot while any notification is unread, kept live through Realtime
 * (only the user's own rows arrive). A new one turns the dot on; a read mark
 * reads the count again.
 */
export function NotificationBell({ userId, unread: initial }: { userId: string; unread: boolean }) {
  const t = useTranslations("Notifications");
  const [unread, setUnread] = useState(initial);
  // A fresh server read wins (React's pattern for state derived from props).
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setUnread(initial);
  }

  const recount = useCallback(() => {
    void createClient()
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .is("read_at", null)
      .then(({ count, error }) => {
        if (!error) setUnread((count ?? 0) > 0);
      });
  }, []);

  usePostgresChanges({
    table: "notifications",
    filter: `user_id=eq.${userId}`,
    events: ["INSERT", "UPDATE"],
    onChange: (_row, event) => (event === "INSERT" ? setUnread(true) : recount()),
    onSubscribed: recount,
  });

  return (
    <IconButton
      href={routes.notifications}
      label={unread ? t("bellUnread") : t("bell")}
      icon={Bell}
      variant="dark"
      dot={unread}
    />
  );
}
