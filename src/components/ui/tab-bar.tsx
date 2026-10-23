import { House, type LucideIcon, MessageSquare, NotepadText, Plus, User } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/cn";
import { routes } from "@/lib/routes";

export type Tab = "home" | "orders" | "chat" | "profile";

const tabs: { id: Tab; href: string; icon: LucideIcon }[] = [
  { id: "home", href: routes.home, icon: House },
  { id: "orders", href: routes.orders, icon: NotepadText },
  { id: "chat", href: routes.chat, icon: MessageSquare },
  { id: "profile", href: routes.profile, icon: User },
];

type TabBarProps = {
  /** The highlighted tab. Tips and Notifications pass "home" (spec §5.18). */
  active?: Tab;
  /** Unread support messages: a dot on المحادثة. */
  chatUnread?: boolean;
  className?: string;
};

/**
 * The customer tab bar (TabBar.dc.html): four tabs around the raised
 * احجز button. Sticks to the bottom of the screen and clears the iPhone
 * home indicator. Shown only on Home, Tips, Notifications, Orders and
 * Profile (spec §5).
 */
export function TabBar({ active, chatUnread = false, className }: TabBarProps) {
  const t = useTranslations("UI.tabs");

  const tab = ({ id, href, icon: Icon }: (typeof tabs)[number]) => {
    const isActive = id === active;
    return (
      <li key={id}>
        <Link
          href={href}
          aria-current={isActive ? "page" : undefined}
          className={cn(
            "flex min-h-13 flex-col items-center justify-center gap-0.5 text-12",
            isActive ? "font-extrabold text-teal" : "font-semibold text-muted",
          )}
        >
          <span className="relative">
            <Icon aria-hidden className="size-6" strokeWidth={2} />
            {id === "chat" && chatUnread && (
              <span
                aria-hidden
                className="absolute -end-1 -top-0.5 size-2.5 rounded-full border-2 border-surface bg-warn"
              />
            )}
          </span>
          {t(id)}
          {id === "chat" && chatUnread && <span className="sr-only">{t("chatUnread")}</span>}
        </Link>
      </li>
    );
  };

  return (
    <nav
      aria-label={t("label")}
      className={cn(
        "sticky bottom-0 z-30 w-full border-t border-border bg-surface pb-safe-2.5",
        className,
      )}
    >
      <ul className="grid h-18.5 grid-cols-5 items-center">
        {tabs.slice(0, 2).map(tab)}
        <li>
          {/* The canvas labels this link "حجز جديد"; the visible "احجز" is
              used instead so the spoken name matches what is on screen. */}
          <Link
            href={routes.book}
            className="flex flex-col items-center gap-0.5 text-12 font-extrabold text-navy"
          >
            <span className="-mt-6.5 flex size-14 items-center justify-center rounded-card bg-navy shadow-fab">
              <Plus aria-hidden className="size-6.5 text-aqua" strokeWidth={2.6} />
            </span>
            {t("book")}
          </Link>
        </li>
        {tabs.slice(2).map(tab)}
      </ul>
    </nav>
  );
}
