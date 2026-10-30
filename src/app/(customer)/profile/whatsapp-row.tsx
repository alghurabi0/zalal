"use client";

import { useTranslations } from "next-intl";

import { WhatsAppIcon } from "@/components/icons/whatsapp-icon";
import { CompanyContactSheet, contactLink } from "@/components/layout/call-company";

const rowClasses =
  "flex min-h-14 w-full items-center gap-3 border-b border-divider px-4 text-start text-17 font-extrabold";

/**
 * "راسلنا على واتساب" under help (settled Oct 30, 2026): one company phone
 * opens WhatsApp, two open a sheet with both. Nothing while none is set.
 */
export function WhatsAppRow({ phones }: { phones: string[] }) {
  const t = useTranslations("Profile");
  const [first] = phones;
  if (!first) return null;
  const content = (
    <>
      <WhatsAppIcon aria-hidden className="size-5.5 text-whatsapp" />
      {t("whatsapp")}
    </>
  );
  if (phones.length === 1) {
    return (
      <a {...contactLink("whatsapp", first)} className={rowClasses}>
        {content}
      </a>
    );
  }
  return (
    <CompanyContactSheet phones={phones} channel="whatsapp">
      <button type="button" className={rowClasses}>
        {content}
      </button>
    </CompanyContactSheet>
  );
}
