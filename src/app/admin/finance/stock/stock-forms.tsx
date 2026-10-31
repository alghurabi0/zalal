"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";

import { Money } from "@/components/admin/finance";
import { ReadOnlyRecord, VoidForm } from "@/components/admin/finance-forms";
import { useAdminEdit } from "@/components/admin/use-admin-edit";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { AdminEditError } from "@/lib/admin/edit-errors";
import { adminStockHref } from "@/lib/admin/finance-query";
import type { LinkableExpense, StockItem, StockMove } from "@/lib/admin/stock-queries";
import { cn } from "@/lib/cn";
import { formatDay, formatDayTime } from "@/lib/dates";
import { NOTE_MAX } from "@/lib/schemas/finance";
import {
  formatQuantity,
  parseQuantity,
  STOCK_NAME_MAX,
  STOCK_UNIT_MAX,
  type StockMoveKind,
} from "@/lib/schemas/stock";

import { deleteStockItem, saveStockItem, saveStockMove, voidStockMove } from "../actions";

// A23's drawers (spec §8.3; Phase 7, task 6): an item's details, and an in,
// out or count with edit and void. The database checks every rule again.

type Option = { id: string; name: string; active: boolean };

function ErrorLine({ error }: { error: AdminEditError | null }) {
  const tErrors = useTranslations("Admin.editErrors");
  return (
    <p role="status" className="text-13 font-bold text-danger">
      {error && tErrors(error)}
    </p>
  );
}

function SavedLine({ shown, text }: { shown: boolean; text: string }) {
  return (
    <p role="status" className={cn("text-13 font-bold text-ok-fg", !shown && "sr-only")}>
      {shown && text}
    </p>
  );
}

/** The item's details; a new item opens its drawer once added. */
export function StockItemForm({
  item,
  deletable,
  month,
  closeHref,
}: {
  item: StockItem | null;
  /** No record names it, voided ones included. */
  deletable: boolean;
  month: string | undefined;
  closeHref: string;
}) {
  const t = useTranslations("Admin.finance");
  const router = useRouter();
  const edit = useAdminEdit();
  const remove = useAdminEdit();
  const [name, setName] = useState(item?.name ?? "");
  const [unit, setUnit] = useState(item?.unit ?? "");
  const [minimum, setMinimum] = useState(item ? formatQuantity(item.minQuantity) : "0");
  const [note, setNote] = useState(item?.note ?? "");
  const [active, setActive] = useState(item?.active ?? true);
  const [tried, setTried] = useState(false);
  const [saved, setSaved] = useState(false);

  const nameOk = name.trim().length >= 2 && name.trim().length <= STOCK_NAME_MAX;
  const unitOk = unit.trim().length >= 1 && unit.trim().length <= STOCK_UNIT_MAX;
  const minQuantity = parseQuantity(minimum);

  return (
    <div className="flex flex-col gap-4">
      <form
        aria-label={item ? t("stock.item.detailsTitle") : t("stock.item.newTitle")}
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setTried(true);
          setSaved(false);
          if (!nameOk || !unitOk || minQuantity === null) return;
          edit.run(
            () => saveStockItem({ id: item?.id ?? null, name, unit, minQuantity, note, active }),
            (result) => {
              if (item) setSaved(true);
              else if ("id" in result)
                router.push(adminStockHref({ month, item: result.id }), { scroll: false });
            },
          );
        }}
      >
        <Field
          label={t("stock.item.name")}
          variant="compact"
          error={tried && !nameOk ? t("stock.item.nameRange") : undefined}
        >
          {(control) => (
            <Input
              {...control}
              variant="compact"
              maxLength={STOCK_NAME_MAX}
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t("stock.item.unit")}
            variant="compact"
            hint={t("stock.item.unitHint")}
            error={tried && !unitOk ? t("stock.item.unitRange") : undefined}
          >
            {(control) => (
              <Input
                {...control}
                variant="compact"
                maxLength={STOCK_UNIT_MAX}
                required
                value={unit}
                onChange={(event) => setUnit(event.target.value)}
              />
            )}
          </Field>
          <Field
            label={t("stock.item.minimum")}
            variant="compact"
            hint={t("stock.item.minimumHint")}
            error={tried && minQuantity === null ? t("stock.item.quantityRange") : undefined}
          >
            {(control) => (
              <Input
                {...control}
                variant="compact"
                inputMode="decimal"
                dir="ltr"
                className="text-end"
                value={minimum}
                onChange={(event) => setMinimum(event.target.value)}
              />
            )}
          </Field>
        </div>
        <Field label={t("stock.item.note")} variant="compact">
          {(control) => (
            <Input
              {...control}
              variant="compact"
              maxLength={NOTE_MAX}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          )}
        </Field>
        <Switch checked={active} onChange={(event) => setActive(event.target.checked)}>
          <span className="text-14 font-bold">{t("stock.item.active")}</span>
        </Switch>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" loading={edit.pending}>
            {item ? t("save") : t("stock.item.create")}
          </Button>
          {!item && (
            <Button size="sm" variant="secondary" href={closeHref} scroll={false}>
              {t("cancel")}
            </Button>
          )}
          <SavedLine shown={saved} text={t("stock.item.saved")} />
          <ErrorLine error={edit.error} />
        </div>
      </form>
      {item && deletable && (
        <div className="flex flex-col gap-2 border-t border-divider pt-4">
          <p className="text-13 text-body-2">{t("stock.item.deleteHint")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              loading={remove.pending}
              onClick={() =>
                remove.run(
                  () => deleteStockItem({ id: item.id }),
                  () => router.push(closeHref, { scroll: false }),
                )
              }
            >
              <Trash2 aria-hidden className="size-4" />
              {t("stock.item.delete")}
            </Button>
            <ErrorLine error={remove.error} />
          </div>
        </div>
      )}
    </div>
  );
}

/** An in, out or count: a new one, or one to edit or void. */
export function StockMoveForm({
  move,
  kind,
  items,
  crews,
  expenses,
  fixedExpense,
  defaultItemId,
  firstDay,
  today,
  closed,
  closeHref,
}: {
  move: StockMove | null;
  kind: StockMoveKind;
  items: StockItem[];
  crews: Option[];
  /** Expenses an in may name. */
  expenses: LinkableExpense[];
  /** A new in for this expense (A16's "سجّل بالمخزن"). */
  fixedExpense: LinkableExpense | null;
  defaultItemId: string | undefined;
  /** The first open day in the books. */
  firstDay: string;
  today: string;
  /** The record is dated in a closed month. */
  closed: boolean;
  closeHref: string;
}) {
  const t = useTranslations("Admin.finance");
  const router = useRouter();
  const edit = useAdminEdit();
  const [itemId, setItemId] = useState(
    move?.itemId ?? defaultItemId ?? items.find((i) => i.active)?.id ?? "",
  );
  const [movedOn, setMovedOn] = useState(move?.movedOn ?? today);
  const [quantity, setQuantity] = useState(move ? formatQuantity(move.quantity) : "");
  const [crewId, setCrewId] = useState(move?.crewId ?? "");
  const [expenseId, setExpenseId] = useState(move?.expense?.id ?? fixedExpense?.id ?? "");
  const [note, setNote] = useState(move?.note ?? "");
  const [tried, setTried] = useState(false);
  const [saved, setSaved] = useState(false);

  const item = items.find((i) => i.id === itemId);
  const unit = item?.unit ?? "";
  const quantityValue = parseQuantity(quantity);
  const quantityOk = quantityValue !== null && (kind === "count" || quantityValue > 0);
  const dayOk = movedOn >= firstDay && movedOn <= today;
  const kindLabel = t(`stock.kinds.${kind}`);

  if (move && (move.voidedAt || closed)) {
    return (
      <ReadOnlyRecord
        rows={[
          [t("stock.move.item"), item?.name],
          [t("stock.move.date"), formatDay(move.movedOn)],
          [t("stock.moveColumns.kind"), kindLabel],
          [
            kind === "count" ? t("stock.move.counted") : t("stock.move.quantity"),
            <span key="q" dir="ltr">
              {t("stock.quantity", { quantity: formatQuantity(move.quantity), unit })}
            </span>,
          ],
          ...(move.crewName ? [[t("stock.move.crew"), move.crewName] as [string, string]] : []),
          ...(move.expense
            ? [
                [
                  t("stock.move.expense"),
                  <span key="e">
                    {move.expense.label} · {formatDay(move.expense.spentOn)} ·{" "}
                    <Money amount={move.expense.amountIqd} />
                  </span>,
                ] as [string, ReactNode],
              ]
            : []),
          ...(move.note ? [[t("stock.move.note"), move.note] as [string, string]] : []),
        ]}
        voidedAt={move.voidedAt}
        voidedBy={move.voidedBy}
        reason={move.voidReason}
      />
    );
  }

  // Only expenses on or before the record's day (the database refuses later ones).
  const expenseOptions = (
    fixedExpense && !expenses.some((e) => e.id === fixedExpense.id)
      ? [fixedExpense, ...expenses]
      : expenses
  ).filter((e) => e.spentOn <= movedOn || e.id === expenseId);

  return (
    <div className="flex flex-col gap-6">
      <form
        aria-label={move ? t("stock.move.editTitle") : t(`stock.move.newTitle.${kind}`)}
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setTried(true);
          setSaved(false);
          if (!itemId || !dayOk || !quantityOk || quantityValue === null) return;
          edit.run(
            () =>
              saveStockMove({
                id: move?.id ?? null,
                itemId,
                movedOn,
                kind,
                quantity: quantityValue,
                crewId: kind === "out" && crewId ? crewId : null,
                expenseId: kind === "in" && expenseId ? expenseId : null,
                note,
              }),
            () => {
              if (move) setSaved(true);
              else router.push(closeHref, { scroll: false });
            },
          );
        }}
      >
        <p className="text-13 text-body-2">{t(`stock.move.kindHints.${kind}`)}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t("stock.move.item")}
            variant="compact"
            error={tried && !itemId ? t("stock.move.pickItem") : undefined}
          >
            {(control) => (
              <Select
                {...control}
                variant="compact"
                disabled={move !== null}
                value={itemId}
                onChange={(event) => setItemId(event.target.value)}
              >
                <option value="" disabled>
                  {t("stock.move.pickItem")}
                </option>
                {items
                  .filter((i) => i.active || i.id === itemId)
                  .map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
          <Field
            label={t("stock.move.date")}
            variant="compact"
            error={
              tried && !dayOk
                ? t("dayRange", { from: formatDay(firstDay), to: formatDay(today) })
                : undefined
            }
          >
            {(control) => (
              <Input
                {...control}
                type="date"
                variant="compact"
                min={firstDay}
                max={today}
                value={movedOn}
                onChange={(event) => setMovedOn(event.target.value)}
              />
            )}
          </Field>
        </div>
        <Field
          label={
            (kind === "count" ? t("stock.move.counted") : t("stock.move.quantity")) +
            (unit ? ` (${unit})` : "")
          }
          variant="compact"
          error={tried && !quantityOk ? t("stock.item.quantityRange") : undefined}
        >
          {(control) => (
            <Input
              {...control}
              variant="compact"
              inputMode="decimal"
              dir="ltr"
              className="text-end"
              required
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
            />
          )}
        </Field>
        {kind === "out" && (
          <Field label={t("stock.move.crew")} variant="compact">
            {(control) => (
              <Select
                {...control}
                variant="compact"
                value={crewId}
                onChange={(event) => setCrewId(event.target.value)}
              >
                <option value="">{t("stock.move.noCrew")}</option>
                {crews
                  .filter((c) => c.active || c.id === crewId)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
        )}
        {kind === "in" && (
          <Field
            label={t("stock.move.expense")}
            variant="compact"
            hint={t("stock.move.expenseHint")}
          >
            {(control) => (
              <Select
                {...control}
                variant="compact"
                value={expenseId}
                onChange={(event) => setExpenseId(event.target.value)}
              >
                <option value="">{t("stock.move.noExpense")}</option>
                {expenseOptions.map((e) => (
                  <option key={e.id} value={e.id}>
                    {t("stock.move.expenseFixed", { label: e.label, date: formatDay(e.spentOn) })}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field label={t("stock.move.note")} variant="compact">
          {(control) => (
            <Input
              {...control}
              variant="compact"
              maxLength={NOTE_MAX}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          )}
        </Field>
        {move && (
          <p className="text-13 text-muted">
            {t("recordedBy", {
              name: move.createdBy ?? t("unknownAdmin"),
              when: formatDayTime(move.createdAt),
            })}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" loading={edit.pending}>
            {move ? t("save") : t("stock.move.create")}
          </Button>
          <Button size="sm" variant="secondary" href={closeHref} scroll={false}>
            {t("cancel")}
          </Button>
          <SavedLine shown={saved} text={t("stock.move.saved")} />
          <ErrorLine error={edit.error} />
        </div>
      </form>
      {move && (
        <VoidForm
          title={t("stock.move.voidTitle")}
          hint={t("stock.move.voidHint")}
          onVoid={(reason) => voidStockMove({ id: move.id, reason })}
          closeHref={closeHref}
        />
      )}
    </div>
  );
}
