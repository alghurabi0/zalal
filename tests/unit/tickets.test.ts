import { describe, expect, it } from "vitest";

import {
  adminRatingsHref,
  adminTicketsHref,
  parseAdminRatingsQuery,
  parseAdminTicketsQuery,
  ratingAverage,
  ticketNumberIn,
} from "@/lib/admin/tickets-query";
import { chatSettingsSchema } from "@/lib/schemas/admin-catalog";
import { addTicketNoteSchema, createTicketSchema } from "@/lib/schemas/ticket";
import { issueErrorFor } from "@/lib/tickets/errors";
import { ticketStatusTone } from "@/lib/tickets/format";
import { ticketObjectPath, ticketObjectPathPattern } from "@/lib/tickets/media";

// The Issue report's input checks, its error codes, and A5/A12's URL
// filters (spec §5.17, §8.2).

const USER = "22222222-2222-4222-8222-222222222222";
const FILE = "33333333-3333-4333-8333-333333333333";

describe("createTicketSchema", () => {
  const base = {
    clientId: crypto.randomUUID(),
    category: "smell",
    description: "  الماي بيه ريحة كلور قوية  ",
    media: [],
  } as const;

  it("trims the description and takes no order", () => {
    const parsed = createTicketSchema.parse(base);
    expect(parsed.description).toBe("الماي بيه ريحة كلور قوية");
    expect(parsed.orderId).toBeUndefined();
  });

  it("needs at least 10 characters after trimming, and at most 1000", () => {
    expect(
      createTicketSchema.safeParse({ ...base, description: "  قصيرة  " }).error?.issues[0]?.message,
    ).toBe("too_short");
    expect(
      createTicketSchema.safeParse({ ...base, description: "ا".repeat(1001) }).error?.issues[0]
        ?.message,
    ).toBe("too_long");
  });

  it("takes up to 3 files from the customer's own folder", () => {
    const path = ticketObjectPath(USER, FILE, "image/jpeg");
    expect(path).toBe(`${USER}/${FILE}.jpg`);
    expect(ticketObjectPathPattern.test(path)).toBe(true);
    const file = { path };
    expect(createTicketSchema.safeParse({ ...base, media: [file, file, file] }).success).toBe(true);
    expect(createTicketSchema.safeParse({ ...base, media: [file, file, file, file] }).success).toBe(
      false,
    );
    expect(createTicketSchema.safeParse({ ...base, media: [{ path: `x/${path}` }] }).success).toBe(
      false,
    );
    expect(
      createTicketSchema.safeParse({ ...base, media: [{ path, durationS: 61 }] }).success,
    ).toBe(false);
  });

  it("refuses an unknown category", () => {
    expect(createTicketSchema.safeParse({ ...base, category: "noise" }).success).toBe(false);
  });
});

describe("addTicketNoteSchema", () => {
  it("needs a note of 1–1000 characters", () => {
    const ticketId = crypto.randomUUID();
    expect(addTicketNoteSchema.safeParse({ ticketId, note: "   " }).success).toBe(false);
    expect(addTicketNoteSchema.parse({ ticketId, note: " تم " }).note).toBe("تم");
    expect(addTicketNoteSchema.safeParse({ ticketId, note: "ا".repeat(1001) }).success).toBe(false);
  });
});

describe("issueErrorFor", () => {
  it.each([
    ["ZL029", "too_many"],
    ["ZL009", "upload_missing"],
    ["ZL028", "order_unavailable"],
    ["P0002", "order_unavailable"],
    ["42501", "failed"],
    [undefined, "failed"],
  ] as const)("%s → %s", (code, error) => expect(issueErrorFor(code)).toBe(error));
});

describe("ticketStatusTone", () => {
  it("is amber when open, blue in progress, grey when closed", () => {
    expect(ticketStatusTone("open")).toBe("warn");
    expect(ticketStatusTone("in_progress")).toBe("info");
    expect(ticketStatusTone("closed")).toBe("neutral");
  });
});

describe("A5 filters", () => {
  it("defaults to open and in-progress tickets from every source", () => {
    expect(parseAdminTicketsQuery({})).toEqual({ status: "active", source: "all", n: 50 });
  });

  it("falls back on bad values and keeps good ones", () => {
    const ticket = crypto.randomUUID();
    expect(
      parseAdminTicketsQuery({ status: "x", source: "rating", q: "  0780 ", n: "9999", ticket }),
    ).toEqual({ status: "active", source: "rating", q: "0780", n: 1000, ticket });
  });

  it("writes only what differs from the defaults", () => {
    expect(adminTicketsHref({ status: "active", source: "all", n: 50 })).toBe("/admin/tickets");
    expect(adminTicketsHref({ status: "closed", q: "علي", ticket: FILE })).toBe(
      `/admin/tickets?status=closed&q=${encodeURIComponent("علي")}&ticket=${FILE}`,
    );
  });

  it("reads a ticket number from a search", () => {
    expect(ticketNumberIn("1024")).toBe(1024);
    expect(ticketNumberIn(" ZL-T-1024 ")).toBe(1024);
    expect(ticketNumberIn("علي")).toBeNull();
    expect(ticketNumberIn("+9647801")).toBeNull();
  });
});

describe("A12", () => {
  it("filters by 1–5 stars", () => {
    expect(parseAdminRatingsQuery({ stars: "2" })).toEqual({ stars: 2, n: 50 });
    expect(parseAdminRatingsQuery({ stars: "7" })).toEqual({ n: 50 });
    expect(adminRatingsHref({ stars: 3 })).toBe("/admin/ratings?stars=3");
    expect(adminRatingsHref({})).toBe("/admin/ratings");
  });

  it("averages the per-star counts to one decimal", () => {
    const counts = (values: number[]) => values.map((ratings, i) => ({ stars: i + 1, ratings }));
    expect(ratingAverage(counts([0, 1, 0, 0, 2]))).toBe(4);
    expect(ratingAverage(counts([1, 0, 0, 0, 2]))).toBe(3.7);
    expect(ratingAverage(counts([0, 0, 0, 0, 0]))).toBeNull();
  });
});

describe("A13's chat section", () => {
  it("takes a response time of 1–72 hours", () => {
    const values = { support_response_text: "" };
    expect(chatSettingsSchema.safeParse({ ...values, ticket_response_hours: 1 }).success).toBe(
      true,
    );
    expect(chatSettingsSchema.safeParse({ ...values, ticket_response_hours: 0 }).success).toBe(
      false,
    );
    expect(chatSettingsSchema.safeParse({ ...values, ticket_response_hours: 73 }).success).toBe(
      false,
    );
  });
});
