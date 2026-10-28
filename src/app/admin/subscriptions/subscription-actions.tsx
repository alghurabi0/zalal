"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";

import { useAdminEdit } from "@/components/admin/use-admin-edit";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { addDays, addMonths, baghdadToday, formatDay } from "@/lib/dates";
import type { SubscriptionState } from "@/lib/subscriptions/state";

import {
  activateSubscription,
  addSubscriptionNote,
  adjustSubscriptionVisits,
  endSubscription,
  setSubscriptionPaid,
} from "./actions";

const NOTE_MAX = 1000;

/** The last day of a subscription starting on `startsOn` (12 months less a day). */
function endsOnFor(startsOn: string): string {
  return addDays(baghdadToday(addMonths(`${startsOn}T12:00:00+03:00`, 12)), -1);
}

/**
 * The A7 drawer's actions, by state. A request: "فعّل" (start date, visits,
 * tanks and price prefilled from the plan, the paid tick, a note) or decline.
 * Running: the paid tick, a visit counted or given back (with a reason), and
 * cancel. Any state: an internal note. The database checks and audits each.
 */
export function SubscriptionActions({
  subscriptionId,
  state,
  paid,
  plan,
  today,
}: {
  subscriptionId: string;
  state: SubscriptionState;
  paid: boolean;
  plan: { visits: number; tanks: number; priceIqd: number | null };
  /** Today in Baghdad, by the server's clock. */
  today: string;
}) {
  const running = state === "active" || state === "upcoming";
  return (
    <div className="flex flex-col gap-3">
      {state === "requested" && (
        <Panel>
          <Activate subscriptionId={subscriptionId} plan={plan} today={today} />
        </Panel>
      )}
      {running && (
        <>
          <Panel>
            <Paid subscriptionId={subscriptionId} paid={paid} />
          </Panel>
          <Panel>
            <Adjust subscriptionId={subscriptionId} />
          </Panel>
        </>
      )}
      {(state === "requested" || state === "active" || state === "upcoming") && (
        <Panel>
          <End subscriptionId={subscriptionId} request={state === "requested"} />
        </Panel>
      )}
      <Panel>
        <Note subscriptionId={subscriptionId} />
      </Panel>
    </div>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4">
      {children}
    </div>
  );
}

function ErrorLine({ error }: { error: ReturnType<typeof useAdminEdit>["error"] }) {
  const t = useTranslations("Admin.editErrors");
  if (!error) return null;
  return (
    <p role="alert" className="text-14 font-bold text-danger">
      {t(error)}
    </p>
  );
}

function Activate({
  subscriptionId,
  plan,
  today,
}: {
  subscriptionId: string;
  plan: { visits: number; tanks: number; priceIqd: number | null };
  today: string;
}) {
  const t = useTranslations("Admin.subscriptions.drawer");
  const edit = useAdminEdit();
  const [startsOn, setStartsOn] = useState(today);
  const [visits, setVisits] = useState(String(plan.visits));
  const [tanks, setTanks] = useState(String(plan.tanks));
  const [price, setPrice] = useState(plan.priceIqd === null ? "" : String(plan.priceIqd));
  const [paid, setPaid] = useState(false);
  const [note, setNote] = useState("");
  const validStart = /^\d{4}-\d{2}-\d{2}$/.test(startsOn);

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        edit.run(
          () =>
            activateSubscription({
              subscriptionId,
              startsOn,
              visits: Number(visits),
              tanks: Number(tanks),
              priceIqd: Number(price),
              paid,
              note,
            }),
          () => undefined,
        );
      }}
    >
      <h3 className="text-16 font-extrabold">{t("activateTitle")}</h3>
      <div className="grid grid-cols-2 gap-3">
        <Field
          label={t("startsOn")}
          variant="compact"
          hint={
            validStart ? t("startsOnHint", { date: formatDay(endsOnFor(startsOn)) }) : undefined
          }
          className="col-span-2"
        >
          {(control) => (
            <Input
              {...control}
              type="date"
              name="startsOn"
              variant="compact"
              min={today}
              required
              value={startsOn}
              onChange={(event) => setStartsOn(event.target.value)}
            />
          )}
        </Field>
        <Field label={t("visitsField")} variant="compact">
          {(control) => (
            <Input
              {...control}
              type="number"
              name="visits"
              variant="compact"
              min={1}
              max={12}
              required
              value={visits}
              onChange={(event) => setVisits(event.target.value)}
            />
          )}
        </Field>
        <Field label={t("tanksField")} variant="compact">
          {(control) => (
            <Input
              {...control}
              type="number"
              name="tanks"
              variant="compact"
              min={1}
              max={6}
              required
              value={tanks}
              onChange={(event) => setTanks(event.target.value)}
            />
          )}
        </Field>
        <Field
          label={t("priceField")}
          variant="compact"
          hint={plan.priceIqd === null ? t("noPrice") : undefined}
          className="col-span-2"
        >
          {(control) => (
            <Input
              {...control}
              type="number"
              name="price"
              variant="compact"
              min={1}
              max={10_000_000}
              step={1}
              required
              dir="ltr"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
            />
          )}
        </Field>
      </div>
      <label className="flex min-h-11 items-center gap-3 text-15 font-bold">
        <input
          type="checkbox"
          name="paid"
          className="size-5 accent-navy"
          checked={paid}
          onChange={(event) => setPaid(event.target.checked)}
        />
        {t("paidField")}
      </label>
      <Field label={t("noteField")} variant="compact">
        {(control) => (
          <Textarea
            {...control}
            name="note"
            rows={2}
            maxLength={NOTE_MAX}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        )}
      </Field>
      <ErrorLine error={edit.error} />
      <Button type="submit" size="sm" loading={edit.pending} className="self-end">
        {t("activate")}
      </Button>
    </form>
  );
}

function Paid({ subscriptionId, paid }: { subscriptionId: string; paid: boolean }) {
  const t = useTranslations("Admin.subscriptions.drawer");
  const edit = useAdminEdit();
  return (
    <>
      <h3 className="text-16 font-extrabold">{t("paidTitle")}</h3>
      <Button
        type="button"
        size="sm"
        variant={paid ? "secondary" : "primary"}
        loading={edit.pending}
        onClick={() =>
          edit.run(
            () => setSubscriptionPaid({ subscriptionId, paid: !paid }),
            () => undefined,
          )
        }
        className="self-start"
      >
        {paid ? t("markUnpaid") : t("markPaid")}
      </Button>
      <ErrorLine error={edit.error} />
    </>
  );
}

function Adjust({ subscriptionId }: { subscriptionId: string }) {
  const t = useTranslations("Admin.subscriptions.drawer");
  const edit = useAdminEdit();
  const [reason, setReason] = useState("");
  const send = (delta: 1 | -1) =>
    edit.run(
      () => adjustSubscriptionVisits({ subscriptionId, delta, reason }),
      () => setReason(""),
    );
  return (
    <>
      <h3 className="text-16 font-extrabold">{t("adjustTitle")}</h3>
      <p className="text-13 text-muted">{t("adjustHint")}</p>
      <Field label={t("reason")} variant="compact">
        {(control) => (
          <Textarea
            {...control}
            name="adjustReason"
            rows={2}
            maxLength={NOTE_MAX}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        )}
      </Field>
      <ErrorLine error={edit.error} />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={reason.trim() === "" || edit.pending}
          onClick={() => send(1)}
        >
          {t("addVisit")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={reason.trim() === "" || edit.pending}
          onClick={() => send(-1)}
        >
          {t("giveBack")}
        </Button>
      </div>
    </>
  );
}

function End({ subscriptionId, request }: { subscriptionId: string; request: boolean }) {
  const t = useTranslations("Admin.subscriptions.drawer");
  const edit = useAdminEdit();
  const [reason, setReason] = useState("");
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        edit.run(
          () => endSubscription({ subscriptionId, reason }),
          () => setReason(""),
        );
      }}
    >
      <h3 className="text-16 font-extrabold">
        {request ? t("endTitleRequest") : t("endTitleActive")}
      </h3>
      <p className="text-13 text-muted">{request ? t("endHintRequest") : t("endHintActive")}</p>
      <Field label={t("reason")} variant="compact">
        {(control) => (
          <Textarea
            {...control}
            name="endReason"
            rows={2}
            maxLength={NOTE_MAX}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        )}
      </Field>
      <ErrorLine error={edit.error} />
      <Button
        type="submit"
        size="sm"
        variant="secondary"
        loading={edit.pending}
        disabled={reason.trim() === ""}
        className="self-end text-danger"
      >
        {request ? t("decline") : t("cancel")}
      </Button>
    </form>
  );
}

function Note({ subscriptionId }: { subscriptionId: string }) {
  const t = useTranslations("Admin.subscriptions.drawer");
  const edit = useAdminEdit();
  const [note, setNote] = useState("");
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!note.trim()) return;
        edit.run(
          () => addSubscriptionNote({ subscriptionId, note }),
          () => setNote(""),
        );
      }}
    >
      <Field label={t("noteLabel")} variant="compact">
        {(control) => (
          <Textarea
            {...control}
            name="note"
            rows={2}
            maxLength={NOTE_MAX}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        )}
      </Field>
      <ErrorLine error={edit.error} />
      <Button
        type="submit"
        size="sm"
        variant="secondary"
        className="self-end"
        loading={edit.pending}
        disabled={note.trim().length === 0}
      >
        {t("addNote")}
      </Button>
    </form>
  );
}
