"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { routes } from "@/lib/routes";

/**
 * مشاركة (spec §5.15): the native share sheet with the public verification
 * link (N15); where there is none, the link is copied instead.
 */
export function ShareButton({
  code,
  certificate,
  primary = false,
  className,
}: {
  code: string;
  certificate: string;
  primary?: boolean;
  className?: string;
}) {
  const t = useTranslations("Report");
  const [message, setMessage] = useState<"copied" | "shareFailed" | null>(null);

  const share = async () => {
    const url = `${window.location.origin}${routes.publicCertificate(code)}`;
    setMessage(null);
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: t("title"), text: t("shareText", { certificate }), url });
        return;
      } catch (error) {
        // Closing the sheet is not a failure.
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setMessage("copied");
    } catch {
      setMessage("shareFailed");
    }
  };

  return (
    <>
      <Button
        type="button"
        size="md"
        variant={primary ? "primary" : "secondary"}
        className={className ?? "text-15"}
        onClick={() => void share()}
      >
        {t("share")}
      </Button>
      {message && (
        <p
          role="status"
          className="absolute start-5 bottom-full mb-2 rounded-chip bg-navy px-3 py-1.5 text-13 font-bold text-white"
        >
          {t(message)}
        </p>
      )}
    </>
  );
}
