import { Share } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * Safari on iPhone and iPad allows Web Push only from an app added to the
 * home screen (iOS 16.4+, spec §9.2): these are the steps, with Safari's
 * share glyph.
 */
export function IosInstallSteps() {
  const t = useTranslations("Notifications.push");
  return (
    <ol className="flex list-inside list-decimal flex-col gap-1 text-13 leading-relaxed text-body-2">
      <li>
        {t.rich("iosShare", {
          icon: () => (
            <Share
              aria-hidden
              className="inline size-4 align-text-bottom text-teal"
              strokeWidth={2.2}
            />
          ),
        })}
      </li>
      <li>{t("iosAdd")}</li>
      <li>{t("iosOpen")}</li>
    </ol>
  );
}
