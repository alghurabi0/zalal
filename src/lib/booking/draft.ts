import { z } from "zod";

import { tankSizes, type TankSize, tankTypes, type TankType } from "@/lib/schemas/tank";

import { type DayOption, findSlot } from "./availability";

// The booking in progress across steps 1–3 (spec §5.9–5.11). Pure functions,
// so the rules are unit-tested; the booking layout keeps the state, and the
// database checks everything again in create_order().

export type SavedTank = { id: string; type: TankType; size: TankSize; nickname: string | null };

export type PriceTable = Record<TankType, Record<TankSize, number>>;

/** The design's starting choice (Booking.dc.html): a roof tank, 1,000–2,000 L. */
export const DEFAULT_NEW_TANK = { type: "roof", size: "m" } as const satisfies {
  type: TankType;
  size: TankSize;
};

const qtySchema = z.number().int().min(1).max(20);

const lineSchema = z.union([
  z.object({ key: z.string().min(1), tankId: z.uuid(), qty: qtySchema }),
  z.object({
    key: z.string().min(1),
    type: z.enum(tankTypes),
    size: z.enum(tankSizes),
    qty: qtySchema,
  }),
]);

/** The shape kept in sessionStorage; anything else read back is dropped. */
export const bookingDraftSchema = z.object({
  version: z.literal(1),
  /**
   * Made on the first "أكّد الحجز" and kept, so create_order() returns the
   * same order when the booking is sent again (a retry, a double tap).
   */
  requestId: z.uuid().nullable(),
  addressId: z.uuid(),
  lines: z.array(lineSchema),
  serviceDate: z.iso.date().nullable(),
  slotId: z.number().int().positive().nullable(),
  note: z.string().max(2000),
});

export type BookingDraft = z.infer<typeof bookingDraftSchema>;
export type DraftLine = BookingDraft["lines"][number];
export type SavedLine = Extract<DraftLine, { tankId: string }>;
export type NewLine = Extract<DraftLine, { type: TankType }>;

export const isSavedLine = (line: DraftLine): line is SavedLine => "tankId" in line;

export type DraftContext = {
  addressId: string;
  savedTanks: SavedTank[];
  days: DayOption[];
};

export function newLine(
  { type, size, qty }: { type: TankType; size: TankSize; qty: number },
  key: string,
): NewLine {
  return { key, type, size, qty };
}

/**
 * A fresh booking: the first open day, and the design's tank when the address
 * has none saved. Deterministic (no random ids), so it can be made while
 * rendering.
 */
export function newDraft(context: DraftContext): BookingDraft {
  return {
    version: 1,
    requestId: null,
    addressId: context.addressId,
    lines:
      context.savedTanks.length === 0
        ? [newLine({ ...DEFAULT_NEW_TANK, qty: 1 }, DEFAULT_LINE_KEY)]
        : [],
    serviceDate: firstOpenDay(context.days),
    slotId: null,
    note: "",
  };
}

/** The key of the line a fresh draft starts with. */
export const DEFAULT_LINE_KEY = "default";

function firstOpenDay(days: DayOption[]): string | null {
  return days.find((day) => !day.full)?.date ?? null;
}

/**
 * Brings a draft in line with what the server says now: another address
 * drops the saved-tank lines (new tank lines carry over), a deleted tank
 * drops its line, and a day or slot that can't be booked any more is
 * cleared. An address with nothing on the list starts with the design's tank.
 */
export function reconcileDraft(draft: BookingDraft, context: DraftContext): BookingDraft {
  const savedIds = new Set(context.savedTanks.map((tank) => tank.id));
  const sameAddress = draft.addressId === context.addressId;
  let lines = draft.lines.filter((line) =>
    isSavedLine(line) ? sameAddress && savedIds.has(line.tankId) : true,
  );
  if (!sameAddress && lines.length === 0 && context.savedTanks.length === 0) {
    lines = [newLine({ ...DEFAULT_NEW_TANK, qty: 1 }, DEFAULT_LINE_KEY)];
  }

  const slot = findSlot(context.days, draft.serviceDate, draft.slotId);
  const dayOpen = context.days.some((day) => day.date === draft.serviceDate && !day.full);
  const serviceDate = dayOpen ? draft.serviceDate : firstOpenDay(context.days);
  const slotId = slot?.bookable && serviceDate === draft.serviceDate ? draft.slotId : null;

  return { ...draft, addressId: context.addressId, lines, serviceDate, slotId };
}

/** Tanks in the order: the lines' quantities added up (create_order counts the same way). */
export function tankCount(lines: DraftLine[]): number {
  return lines.reduce((sum, line) => sum + line.qty, 0);
}

/** A line's tank type and size: its own, or its saved tank's. */
export function lineTank(
  line: DraftLine,
  savedTanks: SavedTank[],
): { type: TankType; size: TankSize; nickname: string | null } | null {
  if (!isSavedLine(line)) return { type: line.type, size: line.size, nickname: null };
  const tank = savedTanks.find((t) => t.id === line.tankId);
  return tank ? { type: tank.type, size: tank.size, nickname: tank.nickname } : null;
}

export function linePrice(line: DraftLine, savedTanks: SavedTank[], prices: PriceTable): number {
  const tank = lineTank(line, savedTanks);
  return tank ? prices[tank.type][tank.size] * line.qty : 0;
}

/** Σ line price × qty (spec §5.9). create_order() prices the order itself. */
export function draftTotal(lines: DraftLine[], savedTanks: SavedTank[], prices: PriceTable) {
  return lines.reduce((sum, line) => sum + linePrice(line, savedTanks, prices), 0);
}

/** Step 1 is done: at least one tank, within the limit, and a slot that can be booked. */
export function detailsComplete(draft: BookingDraft, days: DayOption[], maxTanks: number) {
  const count = tankCount(draft.lines);
  return (
    count > 0 &&
    count <= maxTanks &&
    findSlot(days, draft.serviceDate, draft.slotId)?.bookable === true
  );
}

/** The lines as create_order() takes them. */
export function orderItems(lines: DraftLine[]) {
  return lines.map((line) =>
    isSavedLine(line)
      ? { tankId: line.tankId, qty: line.qty }
      : { type: line.type, size: line.size, qty: line.qty },
  );
}
