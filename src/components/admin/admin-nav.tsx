"use client";

import {
  CalendarClock,
  CalendarRange,
  ClipboardList,
  History,
  LayoutDashboard,
  LogOut,
  MapPinned,
  MessageSquareWarning,
  MessagesSquare,
  Settings,
  ShieldCheck,
  Star,
  Tag,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";

import { LogoutButton } from "@/components/auth/logout-button";
import { cn } from "@/lib/cn";
import { routes } from "@/lib/routes";
import { createClient } from "@/lib/supabase/browser";
import { usePostgresChanges } from "@/lib/supabase/use-postgres-changes";

const items = [
  { href: routes.admin, key: "overview", icon: LayoutDashboard },
  { href: routes.adminOrders, key: "orders", icon: ClipboardList },
  { href: routes.adminChat, key: "chat", icon: MessagesSquare },
  { href: routes.adminTickets, key: "tickets", icon: MessageSquareWarning },
  { href: routes.adminRatings, key: "ratings", icon: Star },
  { href: routes.adminBoard, key: "board", icon: CalendarRange },
  { href: routes.adminLive, key: "live", icon: MapPinned },
  { href: routes.adminPrices, key: "prices", icon: Tag },
  { href: routes.adminSchedule, key: "schedule", icon: CalendarClock },
  { href: routes.adminCrews, key: "crews", icon: Users },
  { href: routes.adminSettings, key: "settings", icon: Settings },
  { href: routes.adminAdmins, key: "admins", icon: ShieldCheck },
  { href: routes.adminAudit, key: "audit", icon: History },
] as const;

/**
 * The item for a page: the longest href that is the page or a folder above
 * it, so /admin/settings/area marks Settings and /admin/orders/board marks
 * the board, not Orders.
 */
function activeHref(pathname: string): string | undefined {
  return items
    .map((item) => item.href as string)
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0];
}

/**
 * The admin shell's navigation (spec §8.2): a sidebar on the start side on
 * desktop, a scrolling row of links on top on tablets.
 */
export function AdminNav({
  name,
  chatUnread,
  openTickets,
  children,
}: {
  name: string | null;
  /** Threads with customer messages no admin has read, when the page loaded. */
  chatUnread: string[];
  /** Open tickets (A5); the shell refreshes on ticket changes (LiveTickets). */
  openTickets: number;
  children?: ReactNode;
}) {
  const t = useTranslations("Admin.nav");
  const pathname = usePathname();
  const unread = useUnreadThreads(chatUnread);

  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 bg-navy px-4 py-3 text-white lg:sticky lg:top-0 lg:h-dvh lg:w-60 lg:flex-col lg:flex-nowrap lg:items-stretch lg:px-3 lg:py-5">
      <div className="flex min-w-0 flex-1 flex-col lg:flex-none lg:px-3">
        <span className="text-18 font-black">{t("title")}</span>
        {name && <span className="truncate text-13 text-on-dark-muted">{name}</span>}
      </div>
      {children}
      <div className="lg:order-last lg:mt-auto">
        <LogoutButton>
          <button
            type="button"
            className="flex min-h-11 w-full items-center gap-2.5 rounded-chip px-3 text-15 font-bold text-on-dark-body hover:bg-navy-2 focus-visible:outline-aqua"
          >
            <LogOut aria-hidden className="size-5 shrink-0 rtl:-scale-x-100" />
            {t("logout")}
          </button>
        </LogoutButton>
      </div>
      <nav
        aria-label={t("label")}
        className="-mx-4 min-w-0 basis-full overflow-x-auto px-4 lg:mx-0 lg:min-h-0 lg:flex-1 lg:basis-auto lg:overflow-x-visible lg:overflow-y-auto lg:px-0"
      >
        <ul className="flex gap-1 lg:flex-col">
          {items.map((item) => {
            const active = item.href === activeHref(pathname);
            const Icon = item.icon;
            return (
              <li key={item.key}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex min-h-11 items-center gap-2.5 rounded-chip px-3 text-15 font-bold whitespace-nowrap focus-visible:outline-aqua",
                    active ? "bg-navy-2 text-aqua" : "text-on-dark-body hover:bg-navy-2",
                  )}
                >
                  <Icon aria-hidden className="size-5 shrink-0" />
                  {t(item.key)}
                  {item.key === "tickets" && openTickets > 0 && (
                    <span className="ms-auto flex h-5.5 min-w-5.5 items-center justify-center rounded-full bg-aqua px-1.5 text-12 font-extrabold text-navy">
                      {openTickets}
                      <span className="sr-only"> {t("ticketsOpen", { count: openTickets })}</span>
                    </span>
                  )}
                  {item.key === "chat" && unread > 0 && (
                    <span className="ms-auto flex h-5.5 min-w-5.5 items-center justify-center rounded-full bg-aqua px-1.5 text-12 font-extrabold text-navy">
                      {unread}
                      <span className="sr-only"> {t("chatUnread", { count: unread })}</span>
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}

/**
 * How many threads have customer messages no admin has read (A4), live:
 * each thread row carries its count, and RLS sends admins every thread.
 */
function useUnreadThreads(initial: string[]): number {
  const [threads, setThreads] = useState(() => new Set(initial));
  // A fresh server read wins (React's pattern for state derived from props).
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setThreads(new Set(initial));
  }
  usePostgresChanges({
    table: "chat_threads",
    events: ["INSERT", "UPDATE"],
    onChange: (row) => {
      const id = String(row.id);
      const unread = Number(row.admin_unread) > 0;
      setThreads((current) => {
        if (current.has(id) === unread) return current;
        const next = new Set(current);
        if (unread) next.add(id);
        else next.delete(id);
        return next;
      });
    },
    // A change before the subscription was live: read the unread threads again.
    onSubscribed: () => {
      void createClient()
        .from("chat_threads")
        .select("id")
        .gt("admin_unread", 0)
        .limit(1000)
        .then(({ data }) => {
          if (data) setThreads(new Set(data.map((thread) => thread.id)));
        });
    },
  });
  return threads.size;
}
