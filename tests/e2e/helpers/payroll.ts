import { newPhone } from "./auth";
import { admin } from "./supabase";

// Payroll fixtures (spec §8.3 A21): a worker written directly, with a
// name of its own so parallel tests never read each other's rows.

/**
 * A worker on daily pay from the first of last month, in the crew given (from
 * the same day) when there is one. `createdBy` is any profile (the records
 * name who made them).
 */
export async function createWorker({
  createdBy,
  crewId = null,
  payType = "per_day",
  amountIqd = 15000,
}: {
  createdBy: string;
  crewId?: string | null;
  payType?: "per_visit" | "per_day" | "monthly";
  amountIqd?: number;
}) {
  const name = `عامل ${newPhone().slice(-6)}`;
  const { data: worker } = await admin
    .from("workers")
    .insert({ name })
    .select("id, name")
    .single()
    .throwOnError();
  const now = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
    .toISOString()
    .slice(0, 10);
  await admin
    .from("worker_rates")
    .insert({
      worker_id: worker.id,
      effective_on: from,
      pay_type: payType,
      amount_iqd: amountIqd,
      created_by: createdBy,
    })
    .throwOnError();
  if (crewId) {
    await admin
      .from("worker_crews")
      .insert({ worker_id: worker.id, crew_id: crewId, from_on: from, created_by: createdBy })
      .throwOnError();
  }
  return worker;
}
