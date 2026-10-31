import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/lib/database.types";

// Stock (spec §8.3 A23; Phase 7, task 6) through the real API, and the
// moments two admins act at once, which pgTAP can't run: a purchase linked
// to an expense being voided meanwhile is refused (ZL067), an expense voided
// while a purchase is being linked to it is refused (ZL064), and two outs at
// once never take an item below zero (ZL065). Everything is dated today.

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
let itemId: string;

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

const today = () => sql(`select (now() at time zone 'Asia/Baghdad')::date`);

/** A live expense today in a general category, as this run's admin. */
function newExpense(): string {
  const category = sql(
    `select id from public.expense_categories where active and kind = 'general' order by id limit 1`,
  );
  const box = sql(`select id from public.finance_accounts where kind = 'cash' and active limit 1`);
  return sql(`
    insert into public.expenses (spent_on, category_id, account_id, amount_iqd, created_by)
    values ('${today()}', ${category}, '${box}', 12000, '${adminId}') returning id
  `);
}

beforeAll(async () => {
  const phone = `+96478${runId}03`;
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
    .update({ role: "admin", full_name: "أمين المخزن" })
    .eq("id", adminId)
    .throwOnError();
  admin = createClient<Database>(status.API_URL, status.PUBLISHABLE_KEY, noSession);
  const { error: signInError } = await admin.auth.signInWithPassword({ phone, password });
  expect(signInError).toBeNull();
});

afterAll(async () => {
  sql(`delete from public.stock_moves where created_by = '${adminId}'`);
  if (itemId) sql(`delete from public.stock_items where id = '${itemId}'`);
  sql(`delete from public.expenses where created_by = '${adminId}'`);
  sql(`delete from public.notifications where user_id = '${adminId}'`);
  sql(`delete from public.admin_audit_log where admin_id = '${adminId}'`);
  await service.auth.admin.deleteUser(adminId);
});

describe("stock over the API", () => {
  it("an admin adds an item and records an in linked to its expense", async () => {
    const item = await admin.rpc("admin_save_stock_item", {
      p_name: `كلور ${runId}`,
      p_unit: "كيلو",
      p_min_quantity: 2,
    });
    expect(item.error).toBeNull();
    itemId = item.data!;
    const expenseId = newExpense();
    const move = await admin.rpc("admin_save_stock_move", {
      p_item_id: itemId,
      p_moved_on: today(),
      p_kind: "in",
      p_quantity: 5.5,
      p_expense_id: expenseId,
    });
    expect(move.error).toBeNull();
    const { data } = await admin.rpc("admin_stock_items");
    expect(data?.find((row) => row.id === itemId)).toMatchObject({ quantity: 5.5, low: false });
  });

  it("refuses linking an expense that is being voided meanwhile", async () => {
    const expenseId = newExpense();
    const voiding = sqlInBackground(`
      begin;
      update public.expenses set voided_at = now(), voided_by = '${adminId}', void_reason = 'خطأ'
      where id = '${expenseId}';
      select pg_sleep(1.5);
      commit;
    `);
    await sleep(400);
    const { error } = await admin.rpc("admin_save_stock_move", {
      p_item_id: itemId,
      p_moved_on: today(),
      p_kind: "in",
      p_quantity: 1,
      p_expense_id: expenseId,
    });
    await voiding;
    expect(error).toMatchObject({ code: "ZL067", message: "expense_not_allowed" });
  });

  it("refuses voiding an expense while a purchase is being linked to it", async () => {
    const expenseId = newExpense();
    const linking = sqlInBackground(`
      begin;
      insert into public.stock_moves (item_id, moved_on, kind, quantity, expense_id, created_by)
      values ('${itemId}', '${today()}', 'in', 1, '${expenseId}', '${adminId}');
      select pg_sleep(1.5);
      commit;
    `);
    await sleep(400);
    const { error } = await admin.rpc("admin_void_expense", { p_id: expenseId, p_reason: "خطأ" });
    await linking;
    expect(error).toMatchObject({ code: "ZL064", message: "expense_has_stock" });
  });

  it("never lets two outs at once take an item below zero", async () => {
    // 6.5 on hand: another admin's out of 4 holds the item while ours asks for 4 too.
    const taking = sqlInBackground(`
      begin;
      select 1 from public.stock_items where id = '${itemId}' for update;
      insert into public.stock_moves (item_id, moved_on, kind, quantity, created_by)
      values ('${itemId}', '${today()}', 'out', 4, '${adminId}');
      select pg_sleep(1.5);
      commit;
    `);
    await sleep(400);
    const { error } = await admin.rpc("admin_save_stock_move", {
      p_item_id: itemId,
      p_moved_on: today(),
      p_kind: "out",
      p_quantity: 4,
    });
    await taking;
    expect(error).toMatchObject({ code: "ZL065", message: "stock_too_low" });
  });
});
