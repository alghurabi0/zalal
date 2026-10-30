"use client";

import { Phone } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { WhatsAppIcon } from "@/components/icons/whatsapp-icon";
import { Button } from "@/components/ui/button";
import { IconButton, type IconButtonVariant } from "@/components/ui/icon-button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/cn";
import { formatPhone, whatsappHref } from "@/lib/phone";

/** How the company is reached: a phone call, or a WhatsApp chat (settled Oct 30, 2026). */
export type ContactChannel = "call" | "whatsapp";

const channels = {
  call: { icon: Phone, title: "callCompany", iconClassName: undefined },
  whatsapp: { icon: WhatsAppIcon, title: "whatsappCompany", iconClassName: "text-whatsapp" },
} as const;

/** The link to one company phone. WhatsApp opens outside the app. */
export function contactLink(channel: ContactChannel, phone: string) {
  return channel === "call"
    ? { href: `tel:${phone}` }
    : { href: whatsappHref(phone), target: "_blank", rel: "noopener noreferrer" };
}

/** The sheet listing both company phones; `children` opens it. */
export function CompanyContactSheet({
  phones,
  channel,
  children,
}: {
  phones: string[];
  channel: ContactChannel;
  children: ReactNode;
}) {
  const t = useTranslations("UI");
  const { icon: Icon, title, iconClassName } = channels[channel];
  return (
    <Sheet>
      <SheetTrigger asChild>{children}</SheetTrigger>
      <SheetContent title={t(title)}>
        <div className="flex flex-col gap-2">
          {phones.map((phone) => (
            <Button key={phone} {...contactLink(channel, phone)} variant="secondary">
              <Icon aria-hidden className={cn("size-5", iconClassName)} strokeWidth={2} />
              <span dir="ltr">{formatPhone(phone)}</span>
            </Button>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * The round call or WhatsApp button (Tracking, Chat). One company phone: it
 * calls it or opens WhatsApp. Two: it opens a sheet with both numbers. None:
 * nothing.
 */
export function CallCompany({
  phones,
  label,
  variant,
  className,
  channel = "call",
}: {
  /** companyPhones(settings) */
  phones: string[];
  label: string;
  variant?: IconButtonVariant;
  className?: string;
  channel?: ContactChannel;
}) {
  const [first] = phones;
  if (!first) return null;
  const { icon, iconClassName } = channels[channel];
  const button = { label, icon, iconClassName, variant, className };
  if (phones.length === 1) return <IconButton {...contactLink(channel, first)} {...button} />;

  return (
    <CompanyContactSheet phones={phones} channel={channel}>
      <IconButton {...button} />
    </CompanyContactSheet>
  );
}
