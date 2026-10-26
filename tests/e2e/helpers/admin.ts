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

/** An active crew with its own crew-role account. */
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
  return data;
}
