"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useId, useState, useTransition } from "react";

import { DaySlotPicker } from "@/components/booking/day-slot-picker";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select, Textarea } from "@/components/ui/input";
import { type DayOption, findSlot } from "@/lib/booking/availability";
import { cn } from "@/lib/cn";
import type { AdminOrderError } from "@/lib/admin/errors";
import { overrideTargets } from "@/lib/admin/orders-query";
import type { CrewOption, OrderStatus } from "@/lib/admin/queries";

import {
  type AdminOrderResult,
  assignCrew,
  cancelOrderAsAdmin,
  confirmOrder,
  markNoShow,
  overrideStatus,
  rescheduleOrderAsAdmin,
} from "./actions";

type Mode = "confirm" | "crew" | "reschedule" | "cancel" | "no_show" | "override";

/** Which actions the order's status offers (spec §6); the database checks again. */
function modesFor(status: OrderStatus): Mode[] {
  switch (status) {
    case "pending_confirmation":
      return ["confirm", "crew", "reschedule", "cancel", "override"];
    case "confirmed":
      return ["crew", "reschedule", "cancel", "no_show", "override"];
    case "on_the_way":
      return ["crew", "no_show", "override"];
    case "arrived":
      return ["no_show", "override"];
    default:
      return ["override"];
  }
}

const REASON_MAX = 500;

/**
 * The A2 drawer's actions: confirm (with a crew), assign crew, reschedule
 * (any slot that hasn't started), cancel and no-show (reason required) and
 * override (any status, reason required). Reasons are staff notes; the
 * customer never sees them.
 */
export function OrderActions({
  orderId,
  status,
  crewId,
  crews,
  days,
  current,
}: {
  orderId: string;
  status: OrderStatus;
  crewId: string | null;
  /** Active crews, plus the order's own crew if it was switched off. */
  crews: CrewOption[];
  /** From admin_slot_board, for reschedule. */
  days: DayOption[];
  current: { serviceDate: string; slotId: number };
}) {
  const t = useTranslations("Admin.actions");
  const router = useRouter();
  const [mode, setMode] = useState<Mode | null>(null);
  const [error, setError] = useState<AdminOrderError | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();
  const modes = modesFor(status);

  const run = (action: () => Promise<AdminOrderResult>) => {
    setError(null);
    setDone(false);
    startTransition(async () => {
      const result = await action();
      if (result.status === "done") {
        setMode(null);
        setDone(true);
        router.refresh();
        return;
      }
      setError(result.error);
      // Another admin, the crew or the customer may have moved the order.
      router.refresh();
    });
  };

  const choose = (next: Mode) => {
    setMode(mode === next ? null : next);
    setError(null);
    setDone(false);
  };

  return (
    <section aria-labelledby={`${orderId}-actions`} className="flex flex-col gap-3">
      <h2 id={`${orderId}-actions`} className="text-16 font-extrabold">
        {t("title")}
      </h2>
      <div className="flex flex-wrap gap-2">
        {modes.map((m) => (
          <Button
            key={m}
            size="sm"
            variant={mode === m ? "primary" : "secondary"}
            aria-expanded={mode === m}
            onClick={() => choose(m)}
            className={cn((m === "cancel" || m === "no_show") && mode !== m && "text-danger")}
          >
            {t(`modes.${m}`)}
          </Button>
        ))}
      </div>

      {mode === "confirm" && (
        <Panel>
          <CrewSelect
            crews={crews}
            value={crewId}
            // Removing a crew is the crew action's job.
            allowNone={crewId === null}
            label={t("confirmCrew")}
            name="crew"
          >
            {(crew) => (
              <Button
                size="card"
                loading={pending}
                onClick={() =>
                  run(() =>
                    confirmOrder({ orderId, crewId: crew && crew !== crewId ? crew : undefined }),
                  )
                }
              >
                {t("confirm")}
              </Button>
            )}
          </CrewSelect>
        </Panel>
      )}

      {mode === "crew" && (
        <Panel>
          <CrewSelect
            crews={crews}
            value={crewId}
            allowNone={status !== "on_the_way"}
            label={t("crew")}
            name="crew"
          >
            {(crew) => (
              <Button
                size="card"
                loading={pending}
                disabled={crew === crewId}
                onClick={() => run(() => assignCrew({ orderId, crewId: crew }))}
              >
                {t("saveCrew")}
              </Button>
            )}
          </CrewSelect>
        </Panel>
      )}

      {mode === "reschedule" && (
        <Panel>
          <Reschedule
            days={days}
            current={current}
            pending={pending}
            onConfirm={(serviceDate, slotId) =>
              run(() => rescheduleOrderAsAdmin({ orderId, serviceDate, slotId }))
            }
          />
        </Panel>
      )}

      {mode === "cancel" && (
        <Panel>
          <ReasonForm
            label={t("cancelReason")}
            submit={t("cancel")}
            danger
            pending={pending}
            onSubmit={(reason) => run(() => cancelOrderAsAdmin({ orderId, reason }))}
          />
        </Panel>
      )}

      {mode === "no_show" && (
        <Panel>
          <ReasonForm
            label={t("noShowNote")}
            submit={t("noShow")}
            danger
            pending={pending}
            onSubmit={(reason) => run(() => markNoShow({ orderId, reason }))}
          />
        </Panel>
      )}

      {mode === "override" && (
        <Panel>
          <Override
            status={status}
            pending={pending}
            onSubmit={(toStatus, reason) =>
              run(() => overrideStatus({ orderId, toStatus, reason }))
            }
          />
        </Panel>
      )}

      <div role="status" className="contents">
        {done && <p className="text-14 font-bold text-ok-fg">{t("saved")}</p>}
      </div>
      {error && (
        <p role="alert" className="text-14 font-bold text-danger">
          {t(`errors.${error}`)}
        </p>
      )}
    </section>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4">
      {children}
    </div>
  );
}

function CrewSelect({
  crews,
  value,
  allowNone,
  label,
  name,
  children,
}: {
  crews: CrewOption[];
  value: string | null;
  allowNone: boolean;
  label: string;
  name: string;
  children: (crew: string | null) => ReactNode;
}) {
  const t = useTranslations("Admin.actions");
  const [crew, setCrew] = useState<string | null>(value);
  return (
    <>
      <Field label={label} variant="compact" hint={crews.length === 0 ? t("noCrews") : undefined}>
        {(control) => (
          <Select
            {...control}
            name={name}
            variant="compact"
            value={crew ?? ""}
            onChange={(event) => setCrew(event.target.value || null)}
          >
            {(allowNone || crew === null) && <option value="">{t("noCrew")}</option>}
            {crews.map((option) => (
              <option key={option.id} value={option.id} disabled={!option.active}>
                {option.active ? option.name : t("inactiveCrew", { name: option.name })}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {children(crew)}
    </>
  );
}

function ReasonForm({
  label,
  submit,
  danger,
  pending,
  onSubmit,
}: {
  label: string;
  submit: string;
  danger?: boolean;
  pending: boolean;
  onSubmit: (reason: string) => void;
}) {
  const t = useTranslations("Admin.actions");
  const [reason, setReason] = useState("");
  const trimmed = reason.trim();
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmed) onSubmit(trimmed);
      }}
    >
      <Field label={label} variant="compact" hint={t("internal")}>
        {(control) => (
          <Textarea
            {...control}
            required
            maxLength={REASON_MAX}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        )}
      </Field>
      <Button
        type="submit"
        size="card"
        loading={pending}
        disabled={!trimmed}
        className={cn(danger && trimmed && "bg-danger")}
      >
        {submit}
      </Button>
    </form>
  );
}

function Reschedule({
  days,
  current,
  pending,
  onConfirm,
}: {
  days: DayOption[];
  current: { serviceDate: string; slotId: number };
  pending: boolean;
  onConfirm: (serviceDate: string, slotId: number) => void;
}) {
  const t = useTranslations("Admin.actions");
  const [serviceDate, setServiceDate] = useState<string | null>(null);
  const [slotId, setSlotId] = useState<number | null>(null);
  const chosen = findSlot(days, serviceDate, slotId);
  const isCurrent = serviceDate === current.serviceDate && slotId === current.slotId;
  return (
    <>
      <p className="text-13 text-muted">{t("rescheduleHint")}</p>
      <DaySlotPicker
        days={days}
        serviceDate={serviceDate}
        slotId={slotId}
        onDayChange={(date) => {
          setServiceDate(date);
          setSlotId(null);
        }}
        onSlotChange={setSlotId}
        current={current}
      />
      <Button
        size="card"
        loading={pending}
        disabled={!chosen?.bookable || isCurrent}
        onClick={() => serviceDate && chosen && onConfirm(serviceDate, chosen.slotId)}
      >
        {t("reschedule")}
      </Button>
    </>
  );
}

function Override({
  status,
  pending,
  onSubmit,
}: {
  status: OrderStatus;
  pending: boolean;
  onSubmit: (toStatus: OrderStatus, reason: string) => void;
}) {
  const t = useTranslations("Admin.actions");
  const tStatus = useTranslations("Orders.status");
  const id = useId();
  const targets = overrideTargets(status);
  const [toStatus, setToStatus] = useState<OrderStatus>(targets[0] ?? status);
  const [reason, setReason] = useState("");
  const trimmed = reason.trim();
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmed) onSubmit(toStatus, trimmed);
      }}
    >
      <p className="rounded-chip bg-warn-bg p-3 text-13 font-bold text-warn-fg">
        {t("overrideWarning")}
      </p>
      <Field label={t("overrideTo")} variant="compact" id={`${id}-to`}>
        {(control) => (
          <Select
            {...control}
            variant="compact"
            value={toStatus}
            onChange={(event) => setToStatus(event.target.value as OrderStatus)}
          >
            {targets.map((target) => (
              <option key={target} value={target}>
                {tStatus(target)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label={t("overrideReason")} variant="compact" hint={t("internal")}>
        {(control) => (
          <Textarea
            {...control}
            required
            maxLength={REASON_MAX}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        )}
      </Field>
      <Button type="submit" size="card" loading={pending} disabled={!trimmed}>
        {t("override")}
      </Button>
    </form>
  );
}
