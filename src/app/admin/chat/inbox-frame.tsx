import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * A4's frame (spec §8.2): the thread list on the start side and the
 * conversation beside it from 1024px, and the customer panel as a third
 * column from 1280px (below the conversation before that). On a narrower
 * screen the list is the inbox page and a conversation is a page of its own.
 */
export async function InboxFrame({
  list,
  listOnSmall,
  children,
}: {
  list: ReactNode;
  /** Whether the list shows below 1024px (the inbox page, not a conversation). */
  listOnSmall: boolean;
  children: ReactNode;
}) {
  const t = await getTranslations("Admin.chat");
  return (
    <main className="flex min-h-0 flex-1 flex-col lg:flex-row xl:h-dvh">
      <section
        aria-labelledby="inbox-title"
        className={cn(
          "min-h-0 flex-col border-border bg-surface lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-80 lg:shrink-0 lg:border-e",
          listOnSmall ? "flex flex-1 lg:flex-none" : "hidden",
        )}
      >
        <h1 id="inbox-title" className="px-4 pt-4 text-22 font-black">
          {t("title")}
        </h1>
        {list}
      </section>
      {children}
    </main>
  );
}

/** Reads one string from a search param that may repeat. */
export function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
