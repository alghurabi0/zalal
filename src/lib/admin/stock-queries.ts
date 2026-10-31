import "server-only";

import { addMonthsTo } from "@/lib/admin/calendar";
import type { StockMoveKind } from "@/lib/schemas/stock";
import { createClient } from "@/lib/supabase/server";

// Reads for stock (spec §8.3 A23; Phase 7, task 6), made as the admin: RLS
// lets admins read the items and their records, and nobody else any.
// Quantities come from admin_stock_items and admin_stock_month, never
// recomputed here.

export type StockItem = {
  id: string;
  name: string;
  unit: string;
  minQuantity: number;
  note: string | null;
  active: boolean;
  /** The quantity now. */
  quantity: number;
  /** Switched on and at or below its minimum. */
  low: boolean;
  lastMovedOn: string | null;
};

/** Every item with its quantity now, by name (`admin_stock_items`). */
export async function stockItems(): Promise<StockItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_stock_items");
  if (error) throw new Error(`Stock items read failed: ${error.code}`);
  return data.map((row) => ({
    id: row.id,
    name: row.name,
    unit: row.unit,
    minQuantity: Number(row.min_quantity),
    note: row.note ?? null,
    active: row.active,
    quantity: Number(row.quantity),
    low: row.low,
    lastMovedOn: row.last_moved_on ?? null,
  }));
}

export type StockMonth = {
  openingQuantity: number;
  inQuantity: number;
  outQuantity: number;
  correctionQuantity: number;
  closingQuantity: number;
};

/** Each item's month by item id (`admin_stock_month`). */
export async function stockMonth(month: string): Promise<Map<string, StockMonth>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_stock_month", { p_month: `${month}-01` });
  if (error) throw new Error(`Stock month read failed: ${error.code}`);
  return new Map(
    data.map((row) => [
      row.item_id,
      {
        openingQuantity: Number(row.opening_quantity),
        inQuantity: Number(row.in_quantity),
        outQuantity: Number(row.out_quantity),
        correctionQuantity: Number(row.correction_quantity),
        closingQuantity: Number(row.closing_quantity),
      },
    ]),
  );
}

export type StockMove = {
  id: string;
  itemId: string;
  movedOn: string;
  kind: StockMoveKind;
  quantity: number;
  crewId: string | null;
  crewName: string | null;
  expense: { id: string; spentOn: string; amountIqd: number; label: string } | null;
  note: string | null;
  createdAt: string;
  createdBy: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  voidedBy: string | null;
};

const MOVE_COLUMNS =
  "id, item_id, moved_on, kind, quantity, crew_id, note, voided_at, void_reason, created_at, " +
  "crew:crews(name), expense:expenses(id, spent_on, amount_iqd, note, category:expense_categories(name)), " +
  "creator:profiles!stock_moves_created_by_fkey(full_name), voider:profiles!stock_moves_voided_by_fkey(full_name)";

type MoveRow = {
  id: string;
  item_id: string;
  moved_on: string;
  kind: StockMoveKind;
  quantity: number;
  crew_id: string | null;
  note: string | null;
  voided_at: string | null;
  void_reason: string | null;
  created_at: string;
  creator: { full_name: string | null } | null;
  voider: { full_name: string | null } | null;
  crew: { name: string } | null;
  expense: {
    id: string;
    spent_on: string;
    amount_iqd: number;
    note: string | null;
    category: { name: string } | null;
  } | null;
};

function toMove(row: MoveRow): StockMove {
  return {
    id: row.id,
    itemId: row.item_id,
    movedOn: row.moved_on,
    kind: row.kind,
    quantity: Number(row.quantity),
    crewId: row.crew_id,
    crewName: row.crew?.name ?? null,
    expense: row.expense
      ? {
          id: row.expense.id,
          spentOn: row.expense.spent_on,
          amountIqd: row.expense.amount_iqd,
          label: row.expense.note ?? row.expense.category?.name ?? "",
        }
      : null,
    note: row.note,
    createdAt: row.created_at,
    createdBy: row.creator?.full_name ?? null,
    voidedAt: row.voided_at,
    voidReason: row.void_reason,
    voidedBy: row.voider?.full_name ?? null,
  };
}

/** The month's records (voided ones too), newest first; one item's when given. */
export async function stockMoves(month: string, itemId?: string): Promise<StockMove[]> {
  const supabase = await createClient();
  let query = supabase
    .from("stock_moves")
    .select(MOVE_COLUMNS)
    .gte("moved_on", `${month}-01`)
    .lt("moved_on", `${addMonthsTo(month, 1)}-01`)
    .order("moved_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(500);
  if (itemId) query = query.eq("item_id", itemId);
  const { data, error } = await query.overrideTypes<MoveRow[], { merge: false }>();
  if (error) throw new Error(`Stock records read failed: ${error.code}`);
  return data.map(toMove);
}

export async function getStockMove(id: string): Promise<StockMove | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("stock_moves")
    .select(MOVE_COLUMNS)
    .eq("id", id)
    .overrideTypes<MoveRow[], { merge: false }>();
  if (error) throw new Error(`Stock record read failed: ${error.code}`);
  return data[0] ? toMove(data[0]) : null;
}

/** The stock an expense paid for (A16's drawer), live records first. */
export async function expenseStock(
  expenseId: string,
): Promise<{ id: string; itemName: string; unit: string; quantity: number; voided: boolean }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("stock_moves")
    .select("id, quantity, voided_at, item:stock_items(name, unit)")
    .eq("expense_id", expenseId)
    .order("moved_on");
  if (error) throw new Error(`Expense stock read failed: ${error.code}`);
  return data
    .map((row) => ({
      id: row.id,
      itemName: row.item?.name ?? "",
      unit: row.item?.unit ?? "",
      quantity: Number(row.quantity),
      voided: row.voided_at !== null,
    }))
    .sort((a, b) => Number(a.voided) - Number(b.voided));
}

export type LinkableExpense = { id: string; spentOn: string; amountIqd: number; label: string };

/**
 * Expenses an in may name: live, in a general category, dated from `from`
 * through `to`, newest first (the database checks the rules again).
 */
export async function linkableExpenses(from: string, to: string): Promise<LinkableExpense[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("expenses")
    .select("id, spent_on, amount_iqd, note, category:expense_categories!inner(name, kind)")
    .is("voided_at", null)
    .eq("category.kind", "general")
    .gte("spent_on", from)
    .lte("spent_on", to)
    .order("spent_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(`Linkable expenses read failed: ${error.code}`);
  return data.map((row) => ({
    id: row.id,
    spentOn: row.spent_on,
    amountIqd: row.amount_iqd,
    label: row.note ?? row.category.name,
  }));
}

/** One expense an in may name, or null when it may not (A16's "سجّل بالمخزن"). */
export async function linkableExpense(id: string): Promise<LinkableExpense | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("expenses")
    .select("id, spent_on, amount_iqd, note, category:expense_categories!inner(name, kind)")
    .eq("id", id)
    .is("voided_at", null)
    .eq("category.kind", "general")
    .maybeSingle();
  if (error) throw new Error(`Linkable expense read failed: ${error.code}`);
  return data
    ? {
        id: data.id,
        spentOn: data.spent_on,
        amountIqd: data.amount_iqd,
        label: data.note ?? data.category.name,
      }
    : null;
}
