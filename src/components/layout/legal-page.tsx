import { FileText } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { BackButton } from "@/components/ui/back-button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { routes } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";

import { Screen } from "./screen";

/**
 * Terms or Privacy (N14), linked from Login. The text is Markdown in
 * settings, shown as plain paragraphs until Phase 6 adds Markdown rendering
 * with the rest of N14. Empty until the owner writes it.
 */
export async function LegalPage({ kind }: { kind: "terms" | "privacy" }) {
  const t = await getTranslations("Legal");
  return (
    <Screen className="gap-5 px-6 pt-5 pb-safe-8">
      <div className="flex items-center gap-3">
        <BackButton href={routes.login} />
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

async function LegalText({ kind }: { kind: "terms" | "privacy" }) {
  const t = await getTranslations("Legal");
  const supabase = await createClient();
  const { data, error } = await supabase.from("settings").select("terms_md, privacy_md").single();
  if (error) throw new Error(`Settings read failed: ${error.message}`);
  const text = (kind === "terms" ? data.terms_md : data.privacy_md).trim();

  if (!text) return <EmptyState icon={FileText} title={t(kind)} description={t("emptyBody")} />;
  return (
    <div className="flex flex-col gap-3 text-15 text-body-2">
      {text.split(/\n\s*\n/).map((paragraph, i) => (
        <p key={i} className="whitespace-pre-line">
          {paragraph}
        </p>
      ))}
    </div>
  );
}
