import { type Page } from "@playwright/test";

import { e164, enterCode, newPhone, requestCode } from "./auth";
import { admin } from "./supabase";

// Admin dashboard test data: staff accounts and customers made directly, so
// tests that aren't about A10 or A14 don't have to go through those screens.

async function createAccount(phone: string, role: "customer" | "crew" | "admin", name: string) {
  const { data, error } = await admin.auth.admin.createUser({
    phone: e164(phone),
    phone_confirm: true,
  });
  if (error) throw error;
  await admin
    .from("profiles")
    .update({ role, full_name: name })
    .eq("id", data.user.id)
    .throwOnError();
  return data.user.id;
}

/** A new admin account, logged in on this page. Ends on Overview. */
export async function logInAsAdmin(page: Page, name = "مشرف التجربة") {
  const phone = newPhone();
  const id = await createAccount(phone, "admin", name);
  await requestCode(page, phone);
  await enterCode(page, phone);
  await page.waitForURL("**/admin");
  return { phone, id };
}

/** A customer with one address at Karbala center, not logged in anywhere. */
export async function createCustomer(name = "زبون التجربة") {
  const phone = newPhone();
  const id = await createAccount(phone, "customer", name);
  await admin
    .from("addresses")
    .insert({
      user_id: id,
      label: "home",
      district: `حي ${phone.slice(-4)}`,
      landmark: "قرب الجامع",
      lat: 32.616,
      lng: 44.024,
    })
    .throwOnError();
  return { phone, id, district: `حي ${phone.slice(-4)}` };
}

/** An active crew with its own crew-role account, not logged in anywhere. */
export async function createCrew() {
  const phone = newPhone();
  const name = `فريق ${phone.slice(-5)}`;
  const userId = await createAccount(phone, "crew", name);
  const { data } = await admin
    .from("crews")
    .insert({ name, user_id: userId })
    .select("id, name")
    .single()
    .throwOnError();
  return { ...data, phone, userId };
}

/** A new crew, logged in on this page. Ends on My jobs (C2). */
export async function logInAsCrew(page: Page) {
  const crew = await createCrew();
  await requestCode(page, crew.phone);
  await enterCode(page, crew.phone);
  await page.waitForURL("**/crew");
  return crew;
}

/**
 * A subscription on the customer's first address (Phase 6), written
 * directly: a request, or active from today for 12 months.
 */
export async function createSubscription(
  phone: string,
  {
    status = "active",
    visits = 2,
    tanks = 1,
  }: { status?: "requested" | "active"; visits?: number; tanks?: number } = {},
): Promise<{ id: string; addressId: string }> {
  const { data: profile } = await admin
    .from("profiles")
    .select("id")
    .eq("phone", e164(phone))
    .single()
    .throwOnError();
  const { data: address } = await admin
    .from("addresses")
    .select("id")
    .eq("user_id", profile.id)
    .is("deleted_at", null)
    .order("created_at")
    .limit(1)
    .single()
    .throwOnError();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad" }).format(new Date());
  const end = new Date(`${today}T00:00:00Z`);
  end.setUTCMonth(end.getUTCMonth() + 12);
  end.setUTCDate(end.getUTCDate() - 1);
  const active = status === "active";
  const { data } = await admin
    .from("subscriptions")
    .insert({
      user_id: profile.id,
      address_id: address.id,
      status,
      price_iqd: active ? 60000 : null,
      visits_total: active ? visits : null,
      tanks_covered: active ? tanks : null,
      starts_on: active ? today : null,
      ends_on: active ? end.toISOString().slice(0, 10) : null,
      activated_at: active ? new Date().toISOString() : null,
    })
    .select("id")
    .single()
    .throwOnError();
  return { id: data.id, addressId: address.id };
}
