import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/lib/database.types";

// Accounting (spec §8.3; Phase 7, task 1) through the real API: an admin
// records an expense over PostgREST (which loads pg-safeupdate, unlike
// pgTAP), and an expense saved while another admin switches its box or
// category off waits for the switch-off and is refused (ZL044), so a
// switched-off box or category never takes a new record (RLS audit of
// migration finance_ledger). Two transactions at once can't run in pgTAP.

const status = JSON.parse(
  execFileSync("pnpm", ["exec", "supabase", "status", "-o", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }),
) as { API_URL: string; DB_URL: string; PUBLISHABLE_KEY: string; SECRET_KEY: string };

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient<Database>(status.API_URL, status.SECRET_KEY, noSession);
const runId = String(Date.now()).slice(-6);
let adminId: string;
let admin: SupabaseClient<Database>;

function sql(query: string) {
  return execFileSync("psql", [status.DB_URL, "-v", "ON_ERROR_STOP=1", "-qAtc", query], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
}

/** Runs SQL in its own session without waiting; resolves when it ends. */
function sqlInBackground(query: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("psql", [status.DB_URL, "-v", "ON_ERROR_STOP=1", "-qAtc", query], {
      stdio: ["ignore", "ignore", "inherit"],
    });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`psql exit ${code}`))));
  });
}

/** Holds the row like a switch-off in another admin's transaction, then switches it off. */
function switchOffSlowly(table: "finance_accounts" | "expense_categories", id: string | number) {
  return sqlInBackground(`
    begin;
    select 1 from public.${table} where id = '${id}' for update;
    select pg_sleep(1.5);
    update public.${table} set active = false where id = '${id}';
    commit;
  `);
}

const today = () => sql(`select (now() at time zone 'Asia/Baghdad')::date`);

beforeAll(async () => {
  const phone = `+96478${runId}01`;
  const password = randomBytes(32).toString("base64url");
  const { data, error } = await service.auth.admin.createUser({
    phone,
    phone_confirm: true,
    password,
  });
  expect(error).toBeNull();
  adminId = data.user!.id;
  await service
    .from("profiles")
    .update({ role: "admin", full_name: "محاسب" })
    .eq("id", adminId)
    .throwOnError();
  admin = createClient<Database>(status.API_URL, status.PUBLISHABLE_KEY, noSession);
  const { error: signInError } = await admin.auth.signInWithPassword({ phone, password });
  expect(signInError).toBeNull();
});

afterAll(async () => {
  // Records name their admin (on delete restrict), so they go first.
  sql(`delete from public.expenses where created_by = '${adminId}'`);
  sql(`delete from public.finance_accounts where name like '%${runId}'`);
  sql(`delete from public.expense_categories where name like '%${runId}'`);
  sql(`delete from public.admin_audit_log where admin_id = '${adminId}'`);
  await service.auth.admin.deleteUser(adminId);
});

async function newBox(): Promise<string> {
  const { data, error } = await admin.rpc("admin_save_finance_account", {
    p_kind: "cash",
    p_name: `صندوق ${runId}`,
  });
  expect(error).toBeNull();
  return data!;
}

async function newCategory(): Promise<number> {
  const { data, error } = await admin.rpc("admin_save_expense_category", {
    p_name: `باب ${runId}`,
  });
  expect(error).toBeNull();
  return data!;
}

describe("expenses over the API", () => {
  let boxId: string;
  let categoryId: number;

  it("an admin records an expense", async () => {
    [boxId, categoryId] = await Promise.all([newBox(), newCategory()]);
    const { data, error } = await admin.rpc("admin_save_expense", {
      p_spent_on: today(),
      p_category_id: categoryId,
      p_account_id: boxId,
      p_amount_iqd: 12000,
      p_note: "بانزين",
    });
    expect(error).toBeNull();
    const { data: row } = await admin
      .from("finance_account_balances")
      .select("balance_iqd")
      .eq("account_id", boxId)
      .single();
    expect(row?.balance_iqd).toBe(-12000);
    expect(data).toBeTruthy();
  });

  it("refuses an expense on a box being switched off meanwhile", async () => {
    const switching = switchOffSlowly("finance_accounts", boxId);
    await sleep(400);
    const { error } = await admin.rpc("admin_save_expense", {
      p_spent_on: today(),
      p_category_id: categoryId,
      p_account_id: boxId,
      p_amount_iqd: 5000,
    });
    await switching;
    expect(error).toMatchObject({ code: "ZL044", message: "account_inactive" });
  });

  it("refuses an expense in a category being switched off meanwhile", async () => {
    const box = sql(
      `select id from public.finance_accounts where kind = 'cash' and active limit 1`,
    );
    const switching = switchOffSlowly("expense_categories", categoryId);
    await sleep(400);
    const { error } = await admin.rpc("admin_save_expense", {
      p_spent_on: today(),
      p_category_id: categoryId,
      p_account_id: box,
      p_amount_iqd: 5000,
    });
    await switching;
    expect(error).toMatchObject({ code: "ZL044", message: "category_inactive" });
  });
});
