import { describe, expect, it } from "vitest";

import { adminCustomersHref, parseAdminCustomersQuery } from "@/lib/admin/customers-query";

// A6's search, sort and drawer in the URL (spec §8.2).

describe("A6 customers query", () => {
  it("defaults to newest first, 50 rows", () => {
    expect(parseAdminCustomersQuery({})).toEqual({ sort: "newest", n: 50 });
  });

  it("falls back on bad values and keeps good ones", () => {
    const customer = crypto.randomUUID();
    expect(
      parseAdminCustomersQuery({ sort: "most_orders", q: "  0780 ", n: "9999", customer }),
    ).toEqual({ sort: "most_orders", q: "0780", n: 1000, customer });
    expect(parseAdminCustomersQuery({ sort: "name", q: "   ", n: "x", customer: "nope" })).toEqual({
      sort: "newest",
      n: 50,
    });
    expect(parseAdminCustomersQuery({ q: "ا".repeat(61) })).toEqual({ sort: "newest", n: 50 });
  });

  it("writes only what differs from the defaults", () => {
    const customer = crypto.randomUUID();
    expect(adminCustomersHref({ sort: "newest", n: 50 })).toBe("/admin/customers");
    expect(adminCustomersHref({ q: "علي", sort: "most_orders", n: 100, customer })).toBe(
      `/admin/customers?q=${encodeURIComponent("علي")}&sort=most_orders&n=100&customer=${customer}`,
    );
  });
});
