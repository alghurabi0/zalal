import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/lib/database.types";

// Month close (spec §8.3; Phase 7, task 3) through the real API: an admin
// closes and reopens last month over PostgREST (which loads pg-safeupdate,
// unlike pgTAP), and an expense dated in a month that closes while it is
// being saved waits for the close and is refused (ZL054). Two transactions
// at once can't run in pgTAP. The books' start day and closed months are
// put back afterwards.

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
let settings: { start_on: string; closed_through: string };

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

// The first day of last month and the last day of it, in Baghdad.
const lastMonth = () =>
  sql(
    `select (date_trunc('month', (now() at time zone 'Asia/Baghdad')::date) - interval '1 month')::date`,
  );
const lastMonthEnd = () =>
  sql(
    `select (date_trunc('month', (now() at time zone 'Asia/Baghdad')::date) - interval '1 day')::date`,
  );

beforeAll(async () => {
  const [start, closed] = sql(
    `select start_on || '|' || coalesce(closed_through::text, '') from public.finance_settings where id`,
  ).split("|");
  settings = { start_on: start!, closed_through: closed! };
  // The books start last month, with nothing closed, so last month can close.
  sql(
    `update public.finance_settings set start_on = least(start_on, '${lastMonth()}'), closed_through = null where id`,
  );
  const phone = `+96478${runId}02`;
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
  sql(`delete from public.expenses where created_by = '${adminId}'`);
  sql(
    `update public.finance_settings set start_on = '${settings.start_on}', ` +
      `closed_through = ${settings.closed_through ? `'${settings.closed_through}'` : "null"} where id`,
  );
  sql(`delete from public.admin_audit_log where admin_id = '${adminId}'`);
  await service.auth.admin.deleteUser(adminId);
});

describe("month close over the API", () => {
  const expense = () => ({
    p_spent_on: lastMonth(),
    p_category_id: Number(
      sql(`select id from public.expense_categories where active order by id limit 1`),
    ),
    p_account_id: sql(
      `select id from public.finance_accounts where kind = 'cash' and active limit 1`,
    ),
    p_amount_iqd: 5000,
  });

  it("an admin closes and reopens last month", async () => {
    const { error } = await admin.rpc("admin_close_finance_month", { p_month: lastMonth() });
    expect(error).toBeNull();
    expect(sql(`select closed_through from public.finance_settings where id`)).toBe(lastMonthEnd());
    const refused = await admin.rpc("admin_save_expense", expense());
    expect(refused.error).toMatchObject({ code: "ZL054", message: "month_closed" });
    const { error: reopenError } = await admin.rpc("admin_reopen_finance_month", {
      p_month: lastMonth(),
      p_reason: "مصروف ناقص",
    });
    expect(reopenError).toBeNull();
    expect(sql(`select closed_through from public.finance_settings where id`)).toBe("");
  });

  it("refuses an expense in a month closing meanwhile", async () => {
    // Another admin's close, held open for a moment.
    const closing = sqlInBackground(`
      begin;
      update public.finance_settings set closed_through = '${lastMonthEnd()}' where id;
      select pg_sleep(1.5);
      commit;
    `);
    await sleep(400);
    const { error } = await admin.rpc("admin_save_expense", expense());
    await closing;
    expect(error).toMatchObject({ code: "ZL054", message: "month_closed" });
    sql(`update public.finance_settings set closed_through = null where id`);
  });
});
