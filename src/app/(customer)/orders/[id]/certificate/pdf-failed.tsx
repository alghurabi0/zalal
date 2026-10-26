"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";

/**
 * "ما كدرنا نجهّز ملف الشهادة" after a failed download (the PDF route adds
 * ?pdf=failed). The parameter is dropped from the address once shown, so a
 * reload or coming back later doesn't repeat an old failure.
 */
export function PdfFailed() {
  const t = useTranslations("Report");
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("pdf");
    window.history.replaceState(window.history.state, "", url);
  }, []);
  return (
    <p
      role="alert"
      className="rounded-input bg-warn-bg px-3.5 py-2.5 text-13 font-bold text-warn-fg"
    >
      {t("pdfFailed")}
    </p>
  );
}
