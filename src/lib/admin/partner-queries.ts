import "server-only";

import type { PartnerMovementKind } from "@/lib/schemas/finance";
import { createClient } from "@/lib/supabase/server";

// Reads for partners, equipment and the balance sheet (spec §8.3 A22; Phase
// 7, task 5), made as the admin: RLS lets admins read the partners, their
// shares and money, the equipment and the disposals, and nobody else any.
// The figures come from admin_balance_sheet, admin_partner_balances and
// admin_equipment, never recomputed here.

/** "2026-10" → "2026-10-01" */
const firstDay = (month: string) => `${month}-01`;

/** The balance sheet at the month's end, or today for this month (`admin_balance_sheet`). */
export type BalanceSheet = {
  asOf: string;
  boxesIqd: number;
  crewCashIqd: number;
  receivablesIqd: number;
  advancesIqd: number;
  equipmentIqd: number;
  assetsIqd: number;
  customerCreditIqd: number;
  wagesOwedIqd: number;
  liabilitiesIqd: number;
  partnersIqd: number;
  unallocatedProfitIqd: number;
  openingDifferenceIqd: number;
  equityIqd: number;
  balanced: boolean;
  closed: boolean;
};

export async function balanceSheet(month: string): Promise<BalanceSheet> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("admin_balance_sheet", { p_month: firstDay(month) })
    .single();
  if (error) throw new Error(`Balance sheet read failed: ${error.code}`);
  return {
    asOf: data.as_of,
    boxesIqd: Number(data.boxes_iqd),
    crewCashIqd: Number(data.crew_cash_iqd),
    receivablesIqd: Number(data.receivables_iqd),
    advancesIqd: Number(data.advances_iqd),
    equipmentIqd: Number(data.equipment_iqd),
    assetsIqd: Number(data.assets_iqd),
    customerCreditIqd: Number(data.customer_credit_iqd),
    wagesOwedIqd: Number(data.wages_owed_iqd),
    liabilitiesIqd: Number(data.liabilities_iqd),
    partnersIqd: Number(data.partners_iqd),
    unallocatedProfitIqd: Number(data.unallocated_profit_iqd),
    openingDifferenceIqd: Number(data.opening_difference_iqd),
    equityIqd: Number(data.equity_iqd),
    balanced: data.balanced,
    closed: data.closed,
  };
}

export type Partner = {
  id: string;
  name: string;
  phone: string | null;
  note: string | null;
  openingCapitalIqd: number;
  active: boolean;
};

/** A partner's figures at the month's end (`admin_partner_balances`). */
export type PartnerBalance = {
  partner: Partner;
  /** The share in force that month, in hundredths of a percent; null: none. */
  shareBp: number | null;
  openingIqd: number;
  capitalIqd: number;
  withdrawnIqd: number;
  /** The month's profit share (below 0, a loss). */
  profitMonthIqd: number;
  /** Every month's profit share since the books' start. */
  profitIqd: number;
  balanceIqd: number;
};

export type PartnerBalances = {
  /** Switched-on partners first, then by share and name. */
  partners: PartnerBalance[];
  /** The profit of months with no shares: that month's, and since the start. */
  unallocated: { monthIqd: number; totalIqd: number };
};

export async function partnerBalances(month: string): Promise<PartnerBalances> {
  const supabase = await createClient();
  const [rows, partners] = await Promise.all([
    supabase.rpc("admin_partner_balances", { p_month: firstDay(month) }),
    supabase.from("partners").select("id, name, phone, note, opening_capital_iqd, active"),
  ]);
  if (rows.error) throw new Error(`Partner balances read failed: ${rows.error.code}`);
  if (partners.error) throw new Error(`Partners read failed: ${partners.error.message}`);
  const partnerOf = new Map(
    partners.data.map((p) => [
      p.id,
      {
        id: p.id,
        name: p.name,
        phone: p.phone,
        note: p.note,
        openingCapitalIqd: p.opening_capital_iqd,
        active: p.active,
      },
    ]),
  );
  const unallocated = { monthIqd: 0, totalIqd: 0 };
  const list: PartnerBalance[] = [];
  for (const row of rows.data) {
    // The row with no partner holds the profit of months with no shares.
    const partner = row.partner_id ? partnerOf.get(row.partner_id) : null;
    if (!row.partner_id) {
      unallocated.monthIqd = Number(row.profit_month_iqd);
      unallocated.totalIqd = Number(row.profit_iqd);
      continue;
    }
    if (!partner) continue;
    list.push({
      partner,
      shareBp: row.share_bp,
      openingIqd: Number(row.opening_iqd),
      capitalIqd: Number(row.capital_iqd),
      withdrawnIqd: Number(row.withdrawn_iqd),
      profitMonthIqd: Number(row.profit_month_iqd),
      profitIqd: Number(row.profit_iqd),
      balanceIqd: Number(row.balance_iqd),
    });
  }
  list.sort(
    (a, b) =>
      Number(b.partner.active) - Number(a.partner.active) ||
      (b.shareBp ?? 0) - (a.shareBp ?? 0) ||
      a.partner.name.localeCompare(b.partner.name, "ar"),
  );
  return { partners: list, unallocated };
}

/** One month's shares: from its first day until the next month with shares. */
export type ShareSet = { month: string; shares: { partnerId: string; shareBp: number }[] };

/** Every month with shares, the newest first. */
export async function shareSets(): Promise<ShareSet[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("partner_shares")
    .select("starts_on, partner_id, share_bp")
    .order("starts_on", { ascending: false })
    .order("share_bp", { ascending: false });
  if (error) throw new Error(`Partner shares read failed: ${error.message}`);
  const sets = new Map<string, ShareSet>();
  for (const row of data) {
    const month = row.starts_on.slice(0, 7);
    const set = sets.get(month) ?? { month, shares: [] };
    set.shares.push({ partnerId: row.partner_id, shareBp: row.share_bp });
    sets.set(month, set);
  }
  return [...sets.values()];
}

export type PartnerMovement = {
  id: string;
  movedOn: string;
  kind: PartnerMovementKind;
  accountId: string;
  amountIqd: number;
  note: string | null;
  voidedAt: string | null;
  voidReason: string | null;
};

/** A partner's capital and withdrawals, the newest first, voided ones included. */
export async function partnerMovements(partnerId: string): Promise<PartnerMovement[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("partner_movements")
    .select("id, moved_on, kind, account_id, amount_iqd, note, voided_at, void_reason")
    .eq("partner_id", partnerId)
    .order("moved_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(`Partner movements read failed: ${error.message}`);
  return data.map((row) => ({
    id: row.id,
    movedOn: row.moved_on,
    kind: row.kind,
    accountId: row.account_id,
    amountIqd: row.amount_iqd,
    note: row.note,
    voidedAt: row.voided_at,
    voidReason: row.void_reason,
  }));
}

/** An equipment item at the month's end (`admin_equipment`). */
export type EquipmentItem = {
  kind: "purchase" | "opening";
  id: string;
  expenseId: string | null;
  openingEquipmentId: string | null;
  name: string;
  acquiredOn: string;
  costIqd: number;
  lifeMonths: number;
  monthlyIqd: number;
  depreciatedIqd: number;
  bookValueIqd: number;
  /** Set once disposed of by the month's end. */
  disposal: {
    id: string;
    disposedOn: string;
    accountId: string | null;
    proceedsIqd: number;
    resultIqd: number;
  } | null;
};

export async function equipment(month: string): Promise<EquipmentItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_equipment", { p_month: firstDay(month) });
  if (error) throw new Error(`Equipment read failed: ${error.code}`);
  return data.map((row) => ({
    kind: row.kind === "opening" ? "opening" : "purchase",
    id: row.item_id,
    expenseId: row.expense_id,
    openingEquipmentId: row.opening_equipment_id,
    name: row.name,
    acquiredOn: row.acquired_on,
    costIqd: Number(row.cost_iqd),
    lifeMonths: row.life_months,
    monthlyIqd: Number(row.monthly_iqd),
    depreciatedIqd: Number(row.depreciated_iqd),
    bookValueIqd: Number(row.book_value_iqd),
    disposal:
      row.disposal_id && row.disposed_on
        ? {
            id: row.disposal_id,
            disposedOn: row.disposed_on,
            accountId: row.disposal_account_id,
            proceedsIqd: Number(row.proceeds_iqd ?? 0),
            resultIqd: Number(row.result_iqd ?? 0),
          }
        : null,
  }));
}

/** Opening equipment as entered (A22's drawer). */
export type OpeningEquipment = {
  id: string;
  name: string;
  valueIqd: number;
  monthsLeft: number;
  note: string | null;
};

export async function getOpeningEquipment(id: string): Promise<OpeningEquipment | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("opening_equipment")
    .select("id, name, value_iqd, months_left, note")
    .eq("id", id)
    .is("voided_at", null)
    .maybeSingle();
  if (error) throw new Error(`Opening equipment read failed: ${error.message}`);
  return data
    ? {
        id: data.id,
        name: data.name,
        valueIqd: data.value_iqd,
        monthsLeft: data.months_left,
        note: data.note,
      }
    : null;
}

/** An item's live disposal, whenever it is dated (A22's drawer). */
export async function liveDisposal(itemId: string): Promise<{
  id: string;
  disposedOn: string;
  accountId: string | null;
  proceedsIqd: number;
  note: string | null;
} | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("equipment_disposals")
    .select("id, disposed_on, account_id, proceeds_iqd, note")
    .or(`expense_id.eq.${itemId},opening_equipment_id.eq.${itemId}`)
    .is("voided_at", null)
    .maybeSingle();
  if (error) throw new Error(`Disposal read failed: ${error.message}`);
  return data
    ? {
        id: data.id,
        disposedOn: data.disposed_on,
        accountId: data.account_id,
        proceedsIqd: data.proceeds_iqd,
        note: data.note,
      }
    : null;
}
