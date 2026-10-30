import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { formatMonthYear } from "@/lib/dates";
import { formatIQD } from "@/lib/money";
import { routes } from "@/lib/routes";

// Pieces the accounting screens share (spec §8.3 A15–A17).

/**
 * An IQD amount, "45,000 د.ع". The number sits in a left-to-right isolate so
 * a minus stays in front of it in the right-to-left line; below zero is red.
 */
export function Money({ amount, className }: { amount: number; className?: string }) {
  const t = useTranslations("UI");
  const negative = amount < 0;
  return (
    <span className={cn("whitespace-nowrap", negative && "text-danger", className)}>
      {t("iqd", { amount: `⁦${negative ? "−" : ""}${formatIQD(Math.abs(amount))}⁩` })}
    </span>
  );
}

/** A box as people say it: its name, or "عهدة فريق 1" for a crew's box. */
export function accountName(
  account: { name: string | null; crewName: string | null },
  crewBox: (crew: string) => string,
): string {
  return account.name ?? crewBox(account.crewName ?? "");
}

const TABS = [
  { key: "boxes", href: routes.adminFinance },
  { key: "expenses", href: routes.adminExpenses },
  { key: "settings", href: routes.adminFinanceSettings },
] as const;

/** The accounting pages' tabs, under the sidebar's single "الحسابات". */
export function FinanceTabs({ current }: { current: (typeof TABS)[number]["key"] }) {
  const t = useTranslations("Admin.finance.tabs");
  return (
    <nav aria-label={t("label")} className="flex flex-wrap gap-2">
      {TABS.map((tab) => {
        const on = tab.key === current;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={on ? "page" : undefined}
            className={cn(
              "flex min-h-11 items-center rounded-full border-2 px-4 text-14 font-bold",
              on ? "border-navy bg-navy text-white" : "border-border bg-surface text-muted",
            )}
          >
            {t(tab.key)}
          </Link>
        );
      })}
    </nav>
  );
}

/** The month shown, with the months before and after it. */
export function MonthPicker({
  month,
  prevHref,
  nextHref,
}: {
  month: string;
  prevHref: string;
  nextHref: string | null;
}) {
  const t = useTranslations("Admin.finance");
  return (
    <div className="flex items-center gap-1">
      <Button href={prevHref} variant="secondary" size="sm" aria-label={t("prevMonth")}>
        <ChevronRight aria-hidden className="size-4" />
      </Button>
      <span className="flex min-h-11 items-center rounded-full border-2 border-navy bg-navy px-4 text-14 font-bold text-white">
        {formatMonthYear(`${month}-15T12:00:00Z`)}
      </span>
      {nextHref ? (
        <Button href={nextHref} variant="secondary" size="sm" aria-label={t("nextMonth")}>
          <ChevronLeft aria-hidden className="size-4" />
        </Button>
      ) : (
        <Button variant="secondary" size="sm" aria-label={t("nextMonth")} disabled>
          <ChevronLeft aria-hidden className="size-4" />
        </Button>
      )}
    </div>
  );
}
