import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { MarkdownText } from "@/components/articles/markdown";
import { BackButton } from "@/components/ui/back-button";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { formatPhone } from "@/lib/phone";
import { routes } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";

import { Screen } from "./screen";

type Kind = "terms" | "privacy";
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Where Back goes: Settings (N13) when opened from there, else Login. */
function backHref(from: unknown): string {
  return from === "settings" ? routes.settings : routes.login;
}

/**
 * Terms or Privacy (N14, spec §5 new screens), from Login and Settings. The
 * text is the admin's Markdown from settings (A13), rendered only through
 * MarkdownText. Until the owner writes it (before launch, §12.4), a short
 * placeholder from ar.json shows instead.
 */
export async function LegalPage({
  kind,
  searchParams,
}: {
  kind: Kind;
  searchParams: SearchParams;
}) {
  const t = await getTranslations("Legal");
  return (
    <Screen className="gap-5 px-6 pt-5 pb-safe-8">
      <div className="flex items-center gap-3">
        <Suspense fallback={<BackButton href={routes.login} />}>
          <Back searchParams={searchParams} />
        </Suspense>
        <h1 className="text-20 font-black">{t(kind)}</h1>
      </div>
      <Suspense
        fallback={
          <SkeletonGroup className="flex flex-col gap-2">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-4/5" />
            <Skeleton className="h-5 w-full" />
          </SkeletonGroup>
        }
      >
        <LegalText kind={kind} />
      </Suspense>
    </Screen>
  );
}

async function Back({ searchParams }: { searchParams: SearchParams }) {
  const { from } = await searchParams;
  return <BackButton href={backHref(from)} />;
}

async function LegalText({ kind }: { kind: Kind }) {
  const t = await getTranslations("Legal");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("settings")
    .select("terms_md, privacy_md, company_phone")
    .single();
  if (error) throw new Error(`Settings read failed: ${error.message}`);
  const text = (kind === "terms" ? data.terms_md : data.privacy_md).trim();

  if (text) return <MarkdownText>{text}</MarkdownText>;
  return (
    <div className="flex flex-col gap-3 text-16 leading-body text-body-2">
      <p>{t("placeholder")}</p>
      <p>
        {data.company_phone
          ? t.rich("placeholderContact", {
              phone: formatPhone(data.company_phone),
              tel: (chunks) => (
                <a
                  href={`tel:${data.company_phone}`}
                  dir="ltr"
                  className="font-bold text-teal underline"
                >
                  {chunks}
                </a>
              ),
            })
          : t("placeholderChat")}
      </p>
    </div>
  );
}
