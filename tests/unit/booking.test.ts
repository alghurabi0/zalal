import { describe, expect, it } from "vitest";

import { type AvailabilityRow, bookingDays } from "@/lib/booking/availability";
import {
  type BookingDraft,
  bookingDraftSchema,
  detailsComplete,
  draftTotal,
  newDraft,
  orderItems,
  type PriceTable,
  reconcileDraft,
  type SavedTank,
  tankCount,
} from "@/lib/booking/draft";
import { bookingErrorFor, stepFor } from "@/lib/booking/errors";
import {
  bookingObjectPath,
  bookingObjectPathPattern,
  contentTypeOf,
  formatBytes,
  formatDuration,
  mediaKindOf,
  roundDuration,
  videoProblem,
} from "@/lib/booking/media";
import { serviceDayParts, slotParts } from "@/lib/dates";
import { formatIQD } from "@/lib/money";
import { createBookingSchema } from "@/lib/schemas/booking";

const USER = "3f0c1a52-8f4e-4d2b-9a77-0b1f4a3c9e21";
const ADDRESS = "7b9e2d10-1c3a-4f56-8e9d-2a4b6c8d0e12";
const OTHER_ADDRESS = "9d1f3b20-2e4c-4a67-9f0e-3b5c7d9e1f23";
const TANK = "5a7c9e11-3d5f-4b78-8a1c-4c6d8e0f2a34";
const REQUEST = "1e3a5c72-4f6b-4d89-9b2d-5d7e9f1a3b45";
const FILE = "2f4b6d83-5a7c-4e9a-8c3e-6e8f0a2b4c56";

const prices: PriceTable = {
  roof: { s: 25000, m: 35000, l: 50000 },
  ground: { s: 60000, m: 80000, l: 120000 },
};
const saved: SavedTank[] = [{ id: TANK, type: "ground", size: "l", nickname: "خزان الحديقة" }];

// Baghdad is UTC+3: 05:00Z is 8 AM there.
const rows: AvailabilityRow[] = [
  row("2026-10-25", 1, "2026-10-25T05:00:00Z", "2026-10-25T07:00:00Z", 2, true),
  row("2026-10-25", 3, "2026-10-25T13:00:00Z", "2026-10-25T15:00:00Z", 1, true),
  row("2026-10-26", 1, "2026-10-26T05:00:00Z", "2026-10-26T07:00:00Z", 0, false),
  row("2026-10-26", 2, "2026-10-26T07:00:00Z", "2026-10-26T09:00:00Z", 0, false),
  row("2026-10-27", 1, "2026-10-27T05:00:00Z", "2026-10-27T07:00:00Z", 2, true),
];

function row(
  service_date: string,
  slot_id: number,
  start_at: string,
  end_at: string,
  remaining: number,
  bookable: boolean,
): AvailabilityRow {
  return { service_date, slot_id, start_at, end_at, remaining, bookable };
}

describe("formatIQD", () => {
  it("groups with commas and Western digits", () => {
    expect(formatIQD(35000)).toBe("35,000");
    expect(formatIQD(120000)).toBe("120,000");
    expect(formatIQD(0)).toBe("0");
  });

  it("refuses fractions: money is integer IQD", () => {
    expect(() => formatIQD(1.5)).toThrow();
  });
});

describe("slot and day labels (Asia/Baghdad)", () => {
  it("names the slot with 12-hour ends and the part of the day", () => {
    expect(slotParts("2026-10-25T05:00:00Z", "2026-10-25T07:00:00Z")).toEqual({
      from: "8",
      to: "10",
      period: "morning",
    });
    expect(slotParts("2026-10-25T07:00:00Z", "2026-10-25T09:00:00Z")).toMatchObject({
      from: "10",
      to: "12",
      period: "noon",
    });
    expect(slotParts("2026-10-25T13:00:00Z", "2026-10-25T15:00:00Z")).toMatchObject({
      from: "4",
      to: "6",
      period: "afternoon",
    });
    expect(slotParts("2026-10-25T14:30:00Z", "2026-10-25T16:30:00Z")).toMatchObject({
      from: "5:30",
      to: "7:30",
      period: "evening",
    });
  });

  it("reads a service date as a calendar day, whatever the device's zone", () => {
    expect(serviceDayParts("2026-10-24")).toEqual({ weekday: "السبت", day: 24 });
    expect(serviceDayParts("2026-10-26")).toEqual({ weekday: "الاثنين", day: 26 });
  });
});

describe("bookingDays", () => {
  // 10 AM in Baghdad on the 25th: the 8 AM slot already passed the 2 h cutoff.
  const now = new Date("2026-10-25T07:00:00Z");

  it("groups by day, drops slots inside the cutoff and marks full days", () => {
    const days = bookingDays(rows, now, 2);
    expect(days.map((d) => d.date)).toEqual(["2026-10-25", "2026-10-26", "2026-10-27"]);
    expect(days[0]!.slots.map((s) => s.slotId)).toEqual([3]);
    expect(days[0]!.full).toBe(false);
    expect(days[1]!.full).toBe(true);
  });

  it("leaves out a day whose slots are all inside the cutoff", () => {
    const late = new Date("2026-10-25T12:00:00Z");
    expect(bookingDays(rows, late, 2).map((d) => d.date)).toEqual(["2026-10-26", "2026-10-27"]);
  });

  it("keeps a slot at exactly the cutoff", () => {
    const edge = new Date("2026-10-25T11:00:00Z");
    expect(bookingDays(rows, edge, 2)[0]!.slots.map((s) => s.slotId)).toEqual([3]);
  });
});

describe("booking draft", () => {
  const days = bookingDays(rows, new Date("2026-10-25T07:00:00Z"), 2);

  it("starts with the design's tank when the address has none saved", () => {
    const draft = newDraft({ addressId: ADDRESS, savedTanks: [], days });
    expect(draft.lines).toEqual([{ key: "default", type: "roof", size: "m", qty: 1 }]);
    expect(draft.serviceDate).toBe("2026-10-25");
    expect(draft.slotId).toBeNull();
    expect(draft.requestId).toBeNull();
    expect(bookingDraftSchema.safeParse(draft).success).toBe(true);
  });

  it("starts empty when the address has saved tanks", () => {
    const draft = newDraft({ addressId: ADDRESS, savedTanks: saved, days });
    expect(draft.lines).toEqual([]);
  });

  it("starts on the first day that isn't full", () => {
    const fullFirst = days.filter((d) => d.date !== "2026-10-25");
    expect(newDraft({ addressId: ADDRESS, savedTanks: [], days: fullFirst }).serviceDate).toBe(
      "2026-10-27",
    );
  });

  const draft: BookingDraft = {
    ...newDraft({ addressId: ADDRESS, savedTanks: saved, days }),
    requestId: REQUEST,
    lines: [
      { key: "s", tankId: TANK, qty: 1 },
      { key: "n", type: "roof", size: "s", qty: 2 },
    ],
    slotId: 3,
  };

  it("adds up tanks and prices (line price × qty)", () => {
    expect(tankCount(draft.lines)).toBe(3);
    expect(draftTotal(draft.lines, saved, prices)).toBe(120000 + 2 * 25000);
    expect(detailsComplete(draft, days, 6)).toBe(true);
    expect(detailsComplete(draft, days, 2)).toBe(false);
    expect(detailsComplete({ ...draft, slotId: null }, days, 6)).toBe(false);
    expect(detailsComplete({ ...draft, lines: [] }, days, 6)).toBe(false);
  });

  it("sends lines the way create_order takes them", () => {
    expect(orderItems(draft.lines)).toEqual([
      { tankId: TANK, qty: 1 },
      { type: "roof", size: "s", qty: 2 },
    ]);
  });

  it("drops saved-tank lines when the address changes, keeping new tanks", () => {
    const moved = reconcileDraft(draft, { addressId: OTHER_ADDRESS, savedTanks: [], days });
    expect(moved.addressId).toBe(OTHER_ADDRESS);
    expect(moved.lines).toEqual([{ key: "n", type: "roof", size: "s", qty: 2 }]);
  });

  it("starts with the design's tank at a new address with nothing on the list", () => {
    const onlySaved = { ...draft, lines: [{ key: "s", tankId: TANK, qty: 1 }] };
    const moved = reconcileDraft(onlySaved, { addressId: OTHER_ADDRESS, savedTanks: [], days });
    expect(moved.lines).toEqual([{ key: "default", type: "roof", size: "m", qty: 1 }]);
  });

  it("drops a line whose saved tank was deleted", () => {
    const same = reconcileDraft(draft, { addressId: ADDRESS, savedTanks: [], days });
    expect(same.lines.map((l) => l.key)).toEqual(["n"]);
  });

  it("clears a slot that can't be booked any more, and a day that filled up", () => {
    const fullDay = { ...draft, serviceDate: "2026-10-26", slotId: 1 };
    const fixed = reconcileDraft(fullDay, { addressId: ADDRESS, savedTanks: saved, days });
    expect(fixed.serviceDate).toBe("2026-10-25");
    expect(fixed.slotId).toBeNull();

    const kept = reconcileDraft(draft, { addressId: ADDRESS, savedTanks: saved, days });
    expect(kept.serviceDate).toBe("2026-10-25");
    expect(kept.slotId).toBe(3);
  });

  it("refuses a stored draft that doesn't match the shape", () => {
    expect(bookingDraftSchema.safeParse({ ...draft, version: 2 }).success).toBe(false);
    expect(bookingDraftSchema.safeParse({ ...draft, requestId: "not-a-uuid" }).success).toBe(false);
    expect(bookingDraftSchema.safeParse({ ...draft, serviceDate: "25/10/2026" }).success).toBe(
      false,
    );
  });
});

describe("booking media rules", () => {
  it("accepts the bucket's types, by MIME type or extension", () => {
    expect(contentTypeOf({ type: "image/jpeg", name: "a.jpg" })).toBe("image/jpeg");
    expect(contentTypeOf({ type: "", name: "IMG_1.HEIC" })).toBe("image/heic");
    expect(contentTypeOf({ type: "", name: "clip.mov" })).toBe("video/quicktime");
    expect(contentTypeOf({ type: "image/gif", name: "a.gif" })).toBeNull();
    expect(contentTypeOf({ type: "application/pdf", name: "a.jpg" })).toBeNull();
    expect(mediaKindOf("video/webm")).toBe("video");
    expect(mediaKindOf("image/png")).toBe("photo");
  });

  it("refuses videos over 60 s or 100 MB, or without a duration", () => {
    expect(videoProblem({ bytes: 1000, durationS: 24 })).toBeNull();
    expect(videoProblem({ bytes: 1000, durationS: 60.3 })).toBeNull();
    expect(videoProblem({ bytes: 1000, durationS: 61 })).toBe("too_long");
    expect(videoProblem({ bytes: 101 * 1024 * 1024, durationS: 10 })).toBe("too_big");
    expect(videoProblem({ bytes: 1000, durationS: null })).toBe("unreadable");
    expect(videoProblem({ bytes: 1000, durationS: Infinity })).toBe("unreadable");
    expect(roundDuration(60.3)).toBe(60);
    expect(roundDuration(24.36)).toBe(24.4);
  });

  it("puts uploads in the customer's own folder", () => {
    const path = bookingObjectPath(USER, FILE, "video/quicktime");
    expect(path).toBe(`customer/${USER}/${FILE}.mov`);
    expect(bookingObjectPathPattern.test(path)).toBe(true);
    expect(bookingObjectPathPattern.test(`customer/${USER}/../x.mov`)).toBe(false);
  });

  it("formats durations and sizes as the file rows show them", () => {
    expect(formatDuration(24.4)).toBe("0:24");
    expect(formatDuration(60)).toBe("1:00");
    expect(formatBytes(18 * 1024 * 1024)).toBe("18 MB");
    expect(formatBytes(2.34 * 1024 * 1024)).toBe("2.3 MB");
    expect(formatBytes(300 * 1024)).toBe("300 KB");
  });
});

describe("createBookingSchema", () => {
  const input = {
    requestId: REQUEST,
    addressId: ADDRESS,
    serviceDate: "2026-10-25",
    slotId: 3,
    items: [
      { tankId: TANK, qty: 1 },
      { type: "roof", size: "m", qty: 2 },
    ],
    note: "  الدرج ضيق  ",
    media: [{ path: `customer/${USER}/${FILE}.mp4`, durationS: 24.4 }],
  };

  it("accepts a booking and trims the note", () => {
    const parsed = createBookingSchema.parse(input);
    expect(parsed.note).toBe("الدرج ضيق");
  });

  it("refuses bad input", () => {
    const bad = (patch: object) => createBookingSchema.safeParse({ ...input, ...patch }).success;
    expect(bad({ items: [] })).toBe(false);
    expect(bad({ items: [{ type: "roof", size: "xl", qty: 1 }] })).toBe(false);
    expect(bad({ items: [{ tankId: TANK, qty: 0 }] })).toBe(false);
    expect(bad({ serviceDate: "25/10/2026" })).toBe(false);
    expect(bad({ note: "x".repeat(501) })).toBe(false);
    expect(bad({ media: [{ path: "customer/other/x.mp4", durationS: 1 }] })).toBe(false);
    expect(bad({ media: [{ path: `customer/${USER}/${FILE}.mp4`, durationS: 61 }] })).toBe(false);
    expect(
      bad({
        media: Array.from({ length: 5 }, () => ({ path: input.media[0]!.path, durationS: 1 })),
      }),
    ).toBe(false);
  });
});

describe("booking errors", () => {
  it("maps create_order's codes and the step that fixes them", () => {
    expect(bookingErrorFor("ZL005")).toBe("slot_full");
    expect(bookingErrorFor("ZL004")).toBe("slot_unavailable");
    expect(bookingErrorFor("ZL001")).toBe("outside_area");
    expect(bookingErrorFor("ZL009")).toBe("upload_missing");
    expect(bookingErrorFor("P0002")).toBe("stale");
    expect(bookingErrorFor("42501")).toBe("failed");
    expect(bookingErrorFor(undefined)).toBe("failed");
    expect(stepFor("slot_full")).toBe("details");
    expect(stepFor("upload_missing")).toBe("photos");
    expect(stepFor("failed")).toBeNull();
  });
});
