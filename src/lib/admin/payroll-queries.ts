import "server-only";

import type { PayrollAdjustmentKind, WorkerPayType } from "@/lib/schemas/finance";
import { createClient } from "@/lib/supabase/server";

import { monthRange } from "./calendar";

// Reads for payroll (spec §8.3 A21; Phase 7, task 4), made as the admin:
// RLS lets admins read the workers and their records, and nobody else any.
// Earned and the balance come from admin_payroll, never recomputed here.

/** A worker's month, from `admin_payroll`. */
export type PayrollRow = {
  workerId: string;
  name: string;
  active: boolean;
  crewId: string | null;
  crewName: string | null;
  payType: WorkerPayType | null;
  rateIqd: number | null;
  visits: number;
  days: number;
  baseIqd: number;
  bonusesIqd: number;
  deductionsIqd: number;
  earnedIqd: number;
  paidIqd: number;
  /** At the month's end: above 0 owed to the worker, below 0 an advance. */
  balanceIqd: number;
};

/** Every worker's month ("2026-10"), switched-on workers first, by name. */
export async function payrollMonth(month: string): Promise<PayrollRow[]> {
  const supabase = await createClient();
  const [rows, workers, crews] = await Promise.all([
    supabase.rpc("admin_payroll", {
      p_from: `${month}-01`,
      p_to: `${month}-01`,
    }),
    supabase.from("workers").select("id, name, active"),
    supabase.from("crews").select("id, name"),
  ]);
  if (rows.error) throw new Error(`Payroll read failed: ${rows.error.message}`);
  if (workers.error) throw new Error(`Workers read failed: ${workers.error.message}`);
  if (crews.error) throw new Error(`Crews read failed: ${crews.error.message}`);
  const workerOf = new Map(workers.data.map((w) => [w.id, w]));
  const crewOf = new Map(crews.data.map((c) => [c.id, c.name]));

  return rows.data
    .map((row) => ({
      workerId: row.worker_id,
      name: workerOf.get(row.worker_id)?.name ?? "",
      active: workerOf.get(row.worker_id)?.active ?? false,
      crewId: row.crew_id,
      crewName: row.crew_id ? (crewOf.get(row.crew_id) ?? null) : null,
      payType: row.pay_type,
      rateIqd: row.rate_iqd,
      visits: row.visits,
      days: row.days,
      baseIqd: Number(row.base_iqd),
      bonusesIqd: Number(row.bonuses_iqd),
      deductionsIqd: Number(row.deductions_iqd),
      earnedIqd: Number(row.earned_iqd),
      paidIqd: Number(row.paid_iqd),
      balanceIqd: Number(row.balance_iqd),
    }))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "ar"));
}

/** A worker's balance at the end of the month (above 0 owed), for A16's "ادفع له". */
export async function workerBalance(workerId: string, month: string): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_payroll", {
    p_from: `${month}-01`,
    p_to: `${month}-01`,
    p_worker_id: workerId,
  });
  if (error) throw new Error(`Payroll read failed: ${error.message}`);
  return Number(data[0]?.balance_iqd ?? 0);
}

/** The month's live wage expenses that name no worker (casual labour). */
export async function unlinkedWages(month: string): Promise<number> {
  const supabase = await createClient();
  const { from, to } = monthRange(month);
  const { data, error } = await supabase
    .from("expenses")
    .select("amount_iqd, category:expense_categories!inner(kind)")
    .eq("category.kind", "wages")
    .is("worker_id", null)
    .is("voided_at", null)
    .gte("spent_on", from)
    .lte("spent_on", to);
  if (error) throw new Error(`Unlinked wages read failed: ${error.message}`);
  return data.reduce((total, row) => total + row.amount_iqd, 0);
}

export type Worker = {
  id: string;
  name: string;
  phone: string | null;
  note: string | null;
  openingBalanceIqd: number;
  active: boolean;
};

export type Membership = {
  id: number;
  crewId: string;
  crewName: string;
  fromOn: string;
  toOn: string | null;
};

export type WorkerRate = {
  id: number;
  effectiveOn: string;
  payType: WorkerPayType;
  amountIqd: number;
  voidedAt: string | null;
  voidReason: string | null;
};

export type PayrollAdjustment = {
  id: number;
  adjustedOn: string;
  kind: PayrollAdjustmentKind;
  amountIqd: number;
  reason: string;
  voidedAt: string | null;
  voidReason: string | null;
};

export type WorkerDetail = {
  worker: Worker;
  /** Newest first. */
  memberships: Membership[];
  /** Newest first, voided ones included. */
  rates: WorkerRate[];
  /** The month's, voided ones included. */
  adjustments: PayrollAdjustment[];
  /** The month's ticked days. */
  days: string[];
  /** The days in the month the worker's crew completed an order while they were in it. */
  crewDays: string[];
};

/** A worker and their records for A21's drawer, or null when there's none. */
export async function getWorkerDetail(id: string, month: string): Promise<WorkerDetail | null> {
  const supabase = await createClient();
  const { from, to } = monthRange(month);
  const [worker, memberships, rates, adjustments, days, crewDays] = await Promise.all([
    supabase
      .from("workers")
      .select("id, name, phone, note, opening_balance_iqd, active")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("worker_crews")
      .select("id, crew_id, from_on, to_on, crew:crews(name)")
      .eq("worker_id", id)
      .order("from_on", { ascending: false }),
    supabase
      .from("worker_rates")
      .select("id, effective_on, pay_type, amount_iqd, voided_at, void_reason")
      .eq("worker_id", id)
      .order("effective_on", { ascending: false })
      .order("id", { ascending: false }),
    supabase
      .from("payroll_adjustments")
      .select("id, adjusted_on, kind, amount_iqd, reason, voided_at, void_reason")
      .eq("worker_id", id)
      .gte("adjusted_on", from)
      .lte("adjusted_on", to)
      .order("adjusted_on")
      .order("id"),
    supabase
      .from("worker_days")
      .select("worked_on")
      .eq("worker_id", id)
      .gte("worked_on", from)
      .lte("worked_on", to)
      .order("worked_on"),
    supabase.rpc("admin_worker_crew_days", { p_worker_id: id, p_month: from }),
  ]);
  if (worker.error) throw new Error(`Worker read failed: ${worker.error.message}`);
  if (!worker.data) return null;
  if (memberships.error) throw new Error(`Memberships read failed: ${memberships.error.message}`);
  if (rates.error) throw new Error(`Rates read failed: ${rates.error.message}`);
  if (adjustments.error) throw new Error(`Bonuses read failed: ${adjustments.error.message}`);
  if (days.error) throw new Error(`Days worked read failed: ${days.error.message}`);
  if (crewDays.error) throw new Error(`Crew days read failed: ${crewDays.error.message}`);

  const w = worker.data;
  return {
    worker: {
      id: w.id,
      name: w.name,
      phone: w.phone,
      note: w.note,
      openingBalanceIqd: w.opening_balance_iqd,
      active: w.active,
    },
    memberships: memberships.data.map((m) => ({
      id: m.id,
      crewId: m.crew_id,
      crewName: m.crew?.name ?? "",
      fromOn: m.from_on,
      toOn: m.to_on,
    })),
    rates: rates.data.map((r) => ({
      id: r.id,
      effectiveOn: r.effective_on,
      payType: r.pay_type,
      amountIqd: r.amount_iqd,
      voidedAt: r.voided_at,
      voidReason: r.void_reason,
    })),
    adjustments: adjustments.data.map((a) => ({
      id: a.id,
      adjustedOn: a.adjusted_on,
      kind: a.kind,
      amountIqd: a.amount_iqd,
      reason: a.reason,
      voidedAt: a.voided_at,
      voidReason: a.void_reason,
    })),
    days: days.data.map((d) => d.worked_on),
    crewDays: crewDays.data,
  };
}

/** Workers for A16's wage picker: switched-on first, by name. */
export async function workerOptions(): Promise<{ id: string; name: string; active: boolean }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("workers").select("id, name, active");
  if (error) throw new Error(`Workers read failed: ${error.message}`);
  return data.sort(
    (a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "ar"),
  );
}

/** Crews for the move picker, switched-on first. */
export async function crewOptions(): Promise<{ id: string; name: string; active: boolean }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("crews").select("id, name, active").order("name");
  if (error) throw new Error(`Crews read failed: ${error.message}`);
  return data.sort((a, b) => Number(b.active) - Number(a.active));
}
