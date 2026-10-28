import { Bell, Download, Inbox, Phone, Send, Truck } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { BackButton } from "@/components/ui/back-button";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip, ChipButton, ChipGroup } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { SheetPanel } from "@/components/ui/sheet-panel";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { StepProgress } from "@/components/ui/step-progress";
import { Stepper } from "@/components/ui/stepper";
import { Switch } from "@/components/ui/switch";
import { TabBar } from "@/components/ui/tab-bar";
import { routes } from "@/lib/routes";

import { LightboxDemo } from "./lightbox-demo";
import { SheetDemo } from "./sheet-demo";

export const metadata: Metadata = { robots: { index: false, follow: false } };

function Section({
  title,
  dark,
  children,
}: {
  title: string;
  dark?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={
        dark
          ? "flex flex-col gap-3 bg-navy px-5 py-6 text-white"
          : "flex flex-col gap-3 border-b border-border px-5 py-6"
      }
    >
      <h2 className="text-16 font-extrabold">{title}</h2>
      {children}
    </section>
  );
}

/**
 * Every UI kit component in its states, for screenshots and e2e tests
 * (tests/e2e/kit.spec.ts). Not part of the app: it is a 404 in production.
 */
export default function KitPage() {
  if (process.env.VERCEL_ENV === "production") notFound();

  const t = useTranslations("Kit");

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-phone flex-col bg-bg">
      <main className="flex flex-1 flex-col">
        <div className="flex items-center gap-3 px-5 pt-4.5">
          <BackButton href={routes.welcome} />
          <h1 className="text-20 font-black">{t("title")}</h1>
        </div>

        <Section title={t("sections.buttons")}>
          <Button>{t("sendCode")}</Button>
          <Button disabled>{t("sendCode")}</Button>
          <Button loading>{t("sendCode")}</Button>
          <div className="flex gap-2.5">
            <Button size="footer" className="flex-1">
              {t("next")}
            </Button>
            <Button size="footer" variant="link" className="text-15">
              {t("skip")}
            </Button>
          </div>
          <div className="flex gap-2.5">
            <Button size="md" className="flex-1">
              {t("sendRating")}
            </Button>
            <Button size="md" variant="secondary" className="text-15">
              {t("share")}
            </Button>
          </div>
          <Button size="card">{t("bookNow")}</Button>
          <div className="flex gap-2">
            <Button size="sm" className="flex-1">
              {t("next")}
            </Button>
            <Button size="sm" variant="secondary">
              {t("help")}
            </Button>
          </div>
        </Section>

        <Section title={t("sections.buttons")} dark>
          <Button variant="accent">{t("sendCode")}</Button>
          <Button variant="ghost" size="card" className="rounded-button text-15">
            {t("skip")}
          </Button>
        </Section>

        <Section title={t("sections.iconButtons")}>
          <div className="flex flex-wrap items-center gap-3 bg-map-bg p-3">
            <BackButton href={routes.welcome} />
            <BackButton href={routes.welcome} variant="floating" />
            <IconButton label={t("call")} icon={Phone} variant="soft" />
            <IconButton
              label={t("sendMessage")}
              icon={Send}
              variant="primary"
              iconClassName="rtl:-scale-x-100"
            />
            <IconButton label={t("call")} icon={Phone} disabled />
          </div>
          <div className="flex items-center gap-3 bg-navy p-3">
            <IconButton label={t("notifications")} icon={Bell} variant="dark" dot />
            <IconButton label={t("download")} icon={Download} variant="dark" />
          </div>
        </Section>

        <Section title={t("sections.chips")}>
          <ChipGroup legend={t("sizeLegend")} bodyClassName="grid grid-cols-3">
            <Chip type="radio" name="size" value="s">
              {t("sizeSmall")}
            </Chip>
            <Chip type="radio" name="size" value="m" defaultChecked>
              {t("sizeMedium")}
            </Chip>
            <Chip type="radio" name="size" value="l" disabled>
              {t("sizeLarge")}
            </Chip>
          </ChipGroup>
          <ChipGroup legend={t("channelLegend")} bodyClassName="grid grid-cols-2 gap-2.5">
            <Chip
              type="radio"
              name="channel"
              value="wa"
              defaultChecked
              className="h-13 rounded-input text-15"
            >
              {t("whatsapp")}
            </Chip>
            <Chip type="radio" name="channel" value="sms" className="h-13 rounded-input text-15">
              {t("sms")}
            </Chip>
          </ChipGroup>
          <ChipGroup legend={t("labelLegend")}>
            <Chip type="radio" variant="pill" name="label" value="home" defaultChecked>
              {t("labelHome")}
            </Chip>
            <Chip type="radio" variant="pill" name="label" value="family">
              {t("labelFamily")}
            </Chip>
            <Chip type="radio" variant="pill" name="label" value="work">
              {t("labelWork")}
            </Chip>
          </ChipGroup>
          <ChipGroup legend={t("tagLegend")} bodyClassName="gap-1.5">
            <Chip type="checkbox" variant="tag" name="tags" value="time" defaultChecked>
              {t("tagTime")}
            </Chip>
            <Chip type="checkbox" variant="tag" name="tags" value="clean">
              {t("tagClean")}
            </Chip>
            <Chip type="checkbox" variant="tag" name="tags" value="polite">
              {t("tagPolite")}
            </Chip>
          </ChipGroup>
          <div className="flex gap-1.5">
            <ChipButton>{t("quickReschedule")}</ChipButton>
            <ChipButton>{t("quickPrice")}</ChipButton>
          </div>
        </Section>

        <Section title={t("sections.cards")}>
          <Card variant="raised" href={routes.home} className="flex items-center gap-3 p-3.5">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-input bg-warn-bg">
              <Truck aria-hidden className="size-6.5 text-warn-icon" />
            </span>
            <span className="flex flex-col">
              <span className="text-15 font-extrabold">{t("onTheWay")}</span>
              <span className="text-13 text-muted">{t("onTheWayBody")}</span>
            </span>
          </Card>
          <Card className="flex flex-col gap-3 p-4">
            <span className="text-16 font-extrabold">{t("tankStatus")}</span>
            <span className="text-13 text-muted">{t("tankStatusBody")}</span>
            <Button size="card" href={routes.book}>
              {t("bookNow")}
            </Button>
          </Card>
          <Card variant="dark" className="flex flex-col gap-1 rounded-20 p-4">
            <span className="text-16 font-extrabold">{t("subscription")}</span>
            <span className="text-13 text-on-dark-muted">{t("subscriptionBody")}</span>
          </Card>
        </Section>

        <Section title={t("sections.inputs")}>
          <Field label={t("phone")} hint={t("phoneHint")}>
            {(control) => (
              <Input
                {...control}
                type="tel"
                inputMode="numeric"
                dir="ltr"
                className="text-18 font-bold tracking-phone"
              />
            )}
          </Field>
          <Field label={t("phone")} error={t("phoneError")}>
            {(control) => <Input {...control} type="tel" dir="ltr" defaultValue="123" />}
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label={t("district")} variant="compact">
              {(control) => <Input {...control} variant="compact" />}
            </Field>
            <Field label={t("landmark")} variant="compact">
              {(control) => <Input {...control} variant="compact" disabled />}
            </Field>
          </div>
          <Field label={t("selectLabel")} variant="compact">
            {(control) => (
              <Select {...control} variant="compact" defaultValue="1">
                <option value="1">{t("selectOne")}</option>
                <option value="2">{t("selectTwo")}</option>
              </Select>
            )}
          </Field>
          <Field label={t("note")} className="gap-1.5">
            {(control) => <Textarea {...control} rows={2} placeholder={t("notePlaceholder")} />}
          </Field>
        </Section>

        <Section title={t("sections.sheet")}>
          <SheetDemo />
          <div className="bg-map-bg pt-6">
            <SheetPanel title={t("sheetTitle")} description={t("sheetBody")}>
              <Button>{t("saveAddress")}</Button>
            </SheetPanel>
          </div>
        </Section>

        <Section title={t("sections.lightbox")}>
          <LightboxDemo />
        </Section>

        <Section title={t("sections.steps")}>
          <StepProgress steps={3} current={1} />
          <StepProgress steps={3} current={2} />
          <StepProgress
            steps={[t("stepConfirmed"), t("stepOnTheWay"), t("stepArrived"), t("stepDone")]}
            current={2}
          />
          <div className="flex items-center justify-between rounded-input border border-border bg-surface px-3 py-2">
            <span className="text-15 font-extrabold">{t("countLabel")}</span>
            <Stepper label={t("countLabel")} name="count" max={6} />
          </div>
          <div className="flex flex-col divide-y divide-divider rounded-input border border-border bg-surface px-3.5">
            <Switch name="reminders" defaultChecked>
              <span className="text-15 font-bold">{t("switchReminder")}</span>
            </Switch>
            <Switch name="subscription">
              <span className="text-15 font-bold">{t("switchSubscription")}</span>
            </Switch>
          </div>
        </Section>

        <Section title={t("sections.skeleton")}>
          <SkeletonGroup className="flex flex-col gap-3">
            <Skeleton className="h-19 rounded-card" />
            <div className="flex gap-3">
              <Skeleton className="size-12 rounded-input" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          </SkeletonGroup>
        </Section>

        <Section title={t("sections.empty")}>
          <EmptyState
            icon={Inbox}
            title={t("emptyTitle")}
            description={t("emptyBody")}
            action={
              <Button size="footer" variant="secondary" href={routes.home} className="w-full">
                {t("emptyCta")}
              </Button>
            }
          />
        </Section>

        <Section title={t("sections.error")}>
          <ErrorState />
        </Section>
      </main>
      <TabBar active="home" chatUnread />
    </div>
  );
}
