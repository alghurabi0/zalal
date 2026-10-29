"use client";

import { Phone } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { IconButton, type IconButtonVariant } from "@/components/ui/icon-button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { formatPhone } from "@/lib/phone";

/**
 * The round call button (Tracking, Chat). One company phone: it calls it.
 * Two: it opens a sheet with both numbers. None: nothing.
 */
export function CallCompany({
  phones,
  label,
  variant,
  className,
}: {
  /** companyPhones(settings) */
  phones: string[];
  label: string;
  variant?: IconButtonVariant;
  className?: string;
}) {
  const t = useTranslations("UI");
  const [first] = phones;
  if (!first) return null;
  const button = { label, icon: Phone, variant, className };
  if (phones.length === 1) return <IconButton href={`tel:${first}`} {...button} />;

  return (
    <Sheet>
      <SheetTrigger asChild>
        <IconButton {...button} />
      </SheetTrigger>
      <SheetContent title={t("callCompany")}>
        <div className="flex flex-col gap-2">
          {phones.map((phone) => (
            <Button key={phone} href={`tel:${phone}`} variant="secondary">
              <Phone aria-hidden className="size-5" strokeWidth={2} />
              <span dir="ltr">{formatPhone(phone)}</span>
            </Button>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
