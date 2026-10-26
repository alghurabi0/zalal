import { describe, expect, it } from "vitest";

import { adminRescheduleDays, type BoardRow, boardGrid } from "@/lib/admin/board";
import { adminOrderErrorFor } from "@/lib/admin/errors";
import {
  adminOrdersHref,
  isActive,
  likePattern,
  overrideTargets,
  parseAdminOrdersQuery,
  soonestFirst,
  statusesFor,
} from "@/lib/admin/orders-query";

const row = (date: string, slot: number, hour: number, extra: Partial<BoardRow> = {}): BoardRow => {
  // Baghdad is UTC+3.
  const start = new Date(`${date}T${String(hour - 3).padStart(2, "0")}:00:00Z`).toISOString();
  const end = new Date(new Date(start).getTime() + 2 * 3600_000).toISOString();
  return {
    service_date: date,
    slot_id: slot,
    start_at: start,
    end_at: end,
    capacity: 2,
    taken: 0,
    blocked: false,
    bookable: true,
    ...extra,
  };
};

describe("parseAdminOrdersQuery", () => {
  it("defaults to the active orders, 50 at a time", () => {
    expect(parseAdminOrdersQuery({})).toEqual({ status: "active", n: 50 });
  });

  it("keeps valid filters and drops bad ones", () => {
    const id = "6c0a3c1e-6f1e-4c1a-9c8e-2f7a1b9d0e11";
    expect(
      parseAdminOrdersQuery({
        status: "confirmed",
        date: "2026-10-26",
        district: "  حي الحسين ",
        crew: id,
        slot: "3",
        n: "100",
        order: id,
      }),
    ).toEqual({
      status: "confirmed",
      date: "2026-10-26",
      district: "حي الحسين",
      crew: id,
      slot: 3,
      n: 100,
      order: id,
    });
    expect(
      parseAdminOrdersQuery({
        status: "nope",
        date: "26/10",
        district: "x".repeat(61),
        crew: "abc",
        slot: "-1",
        n: "99999",
        order: "1",
      }),
    ).toEqual({ status: "active", n: 1000 });
    expect(parseAdminOrdersQuery({ crew: "none", status: ["all", "x"], district: "  " })).toEqual({
      status: "all",
      crew: "none",
      n: 50,
    });
  });
});

describe("filters", () => {
  it("maps status filters to statuses", () => {
    expect(statusesFor("active")).toEqual([
      "pending_confirmation",
      "confirmed",
      "on_the_way",
      "arrived",
      "in_progress",
    ]);
    expect(statusesFor("all")).toHaveLength(8);
    expect(statusesFor("cancelled")).toEqual(["cancelled"]);
    expect(statusesFor("booked")).toHaveLength(7);
    expect(statusesFor("booked")).not.toContain("cancelled");
  });

  it("sorts upcoming work soonest first and the rest newest first", () => {
    expect(soonestFirst({ status: "active" })).toBe(true);
    expect(soonestFirst({ status: "confirmed" })).toBe(true);
    expect(soonestFirst({ status: "all" })).toBe(false);
    expect(soonestFirst({ status: "completed" })).toBe(false);
    expect(soonestFirst({ status: "completed", date: "2026-10-26" })).toBe(true);
  });

  it("builds links without defaults", () => {
    expect(adminOrdersHref({ status: "active", n: 50 })).toBe("/admin/orders");
    expect(adminOrdersHref({ status: "all", date: "2026-10-26", order: "x" })).toBe(
      "/admin/orders?status=all&date=2026-10-26&order=x",
    );
    expect(adminOrdersHref({ district: "حي", n: 100 })).toBe(
      `/admin/orders?district=${encodeURIComponent("حي")}&n=100`,
    );
  });

  it("escapes LIKE wildcards", () => {
    expect(likePattern("50%_a\\b")).toBe("%50\\%\\_a\\\\b%");
  });

  it("offers every other status to override, but not a bare reschedule", () => {
    expect(overrideTargets("confirmed")).not.toContain("pending_confirmation");
    expect(overrideTargets("confirmed")).not.toContain("confirmed");
    expect(overrideTargets("cancelled")).toContain("pending_confirmation");
    expect(overrideTargets("completed")).toHaveLength(7);
    expect(isActive("arrived")).toBe(true);
    expect(isActive("no_show")).toBe(false);
  });
});

describe("adminOrderErrorFor", () => {
  it("maps database codes", () => {
    expect(adminOrderErrorFor({ code: "ZL005" })).toBe("slot_full");
    expect(adminOrderErrorFor({ code: "ZL013" })).toBe("crew_inactive");
    expect(adminOrderErrorFor({ code: "ZL014" })).toBe("crew_change_not_allowed");
    expect(adminOrderErrorFor({ code: "ZL011", message: "crew_not_assigned" })).toBe(
      "crew_not_assigned",
    );
    expect(adminOrderErrorFor({ code: "ZL011", message: "something" })).toBe("failed");
    expect(adminOrderErrorFor({ code: "P0002" })).toBe("not_found");
    expect(adminOrderErrorFor({ code: "42501" })).toBe("failed");
    expect(adminOrderErrorFor(null)).toBe("failed");
  });
});

describe("board", () => {
  const now = new Date("2026-10-26T06:00:00Z"); // 09:00 in Baghdad

  it("offers admins every slot that hasn't started, cutoff or not", () => {
    const days = adminRescheduleDays(
      [
        row("2026-10-26", 1, 8), // started
        row("2026-10-26", 2, 10), // in an hour: fine for admins
        row("2026-10-27", 1, 8, { taken: 2, bookable: false }),
        row("2026-10-28", 1, 8, { blocked: true, bookable: false }),
      ],
      now,
    );
    expect(days.map((d) => d.date)).toEqual(["2026-10-26", "2026-10-27"]);
    expect(days[0]?.slots.map((s) => s.slotId)).toEqual([2]);
    expect(days[1]).toMatchObject({ full: true, slots: [{ remaining: 0, bookable: false }] });
  });

  it("lays the board out as days × slots by time of day", () => {
    const rows = [
      row("2026-10-27", 5, 16),
      row("2026-10-26", 7, 8),
      row("2026-10-27", 7, 8, { blocked: true }),
    ];
    const grid = boardGrid(rows, ["2026-10-26", "2026-10-27"]);
    expect(grid.slots.map((s) => s.slotId)).toEqual([7, 5]);
    expect(grid.days).toEqual([
      { date: "2026-10-26", blocked: false },
      { date: "2026-10-27", blocked: true },
    ]);
    expect(grid.cell("2026-10-26", 5)).toBeUndefined();
    expect(grid.cell("2026-10-27", 5)?.slot_id).toBe(5);
  });
});
