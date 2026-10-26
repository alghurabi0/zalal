"use client";

import {
  CalendarClock,
  CalendarRange,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Settings,
  Tag,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { LogoutButton } from "@/components/auth/logout-button";
import { cn } from "@/lib/cn";
import { routes } from "@/lib/routes";

const items = [
  { href: routes.admin, key: "overview", icon: LayoutDashboard },
  { href: routes.adminOrders, key: "orders", icon: ClipboardList },
  { href: routes.adminBoard, key: "board", icon: CalendarRange },
  { href: routes.adminPrices, key: "prices", icon: Tag },
  { href: routes.adminSchedule, key: "schedule", icon: CalendarClock },
  { href: routes.adminSettings, key: "settings", icon: Settings },
] as const;

/**
 * The admin shell's navigation (spec §8.2): a sidebar on the start side on
 * desktop, a scrolling row of links on top on tablets. Part C adds Crews
 * and Admins here.
 */
export function AdminNav({ name, children }: { name: string | null; children?: ReactNode }) {
  const t = useTranslations("Admin.nav");
  const pathname = usePathname();

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
        className="-mx-4 basis-full overflow-x-auto px-4 lg:mx-0 lg:basis-auto lg:px-0"
      >
        <ul className="flex gap-1 lg:flex-col">
          {items.map((item) => {
            // Settings stays marked on its area editor.
            const active =
              pathname === item.href ||
              (item.href === routes.adminSettings && pathname.startsWith(`${item.href}/`));
            const Icon = item.icon;
            return (
              <li key={item.key}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-11 items-center gap-2.5 rounded-chip px-3 text-15 font-bold whitespace-nowrap focus-visible:outline-aqua",
                    active ? "bg-navy-2 text-aqua" : "text-on-dark-body hover:bg-navy-2",
                  )}
                >
                  <Icon aria-hidden className="size-5 shrink-0" />
                  {t(item.key)}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}
