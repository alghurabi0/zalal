import { describe, expect, it } from "vitest";

import { crewJobErrorFor } from "@/lib/crew/errors";
import { groupJobs, isEmpty, type JobCardData, mapsLink } from "@/lib/crew/jobs";
import { canMarkNoShow, nextStep } from "@/lib/crew/status";
import type { OrderStatus } from "@/lib/orders/status";
import { advanceJobSchema, crewNoShowSchema, finishJobSchema } from "@/lib/schemas/crew-job";

const ID = "5b0f3c1e-2f7a-4a7e-9a55-3c3f4b2a1d10";

describe("nextStep", () => {
  it("walks the crew's path, photos optional", () => {
    expect(nextStep("confirmed")).toEqual({ to: "on_the_way", label: "leave" });
    expect(nextStep("on_the_way")).toEqual({ to: "arrived", label: "arrive" });
    expect(nextStep("arrived")).toEqual({ to: "in_progress", label: "start" });
    expect(nextStep("in_progress")).toEqual({ to: "completed", label: "finish" });
  });

  it.each(["pending_confirmation", "completed", "cancelled", "no_show"] as const)(
    "offers nothing for %s",
    (status) => expect(nextStep(status)).toBeNull(),
  );
});

describe("canMarkNoShow", () => {
  it("is offered until work starts", () => {
    const allowed = (["confirmed", "on_the_way", "arrived"] as const).map(canMarkNoShow);
    expect(allowed).toEqual([true, true, true]);
    const others: OrderStatus[] = ["pending_confirmation", "in_progress", "completed", "no_show"];
    expect(others.map(canMarkNoShow)).toEqual([false, false, false, false]);
  });
});

function job(
  number: number,
  status: OrderStatus,
  service_date: string,
  start: string,
  end = "12:00",
): JobCardData {
  return {
    id: `id-${number}`,
    number,
    status,
    service_date,
    slot_id: 1,
    slot_start_at: `${service_date}T${start}:00+03:00`,
    slot_end_at: `${service_date}T${end}:00+03:00`,
  };
}

describe("groupJobs", () => {
  const today = "2026-10-26";

  it("groups today and tomorrow by slot, earlier open jobs first, done last", () => {
    const groups = groupJobs(
      [
        job(1003, "confirmed", today, "10:00"),
        job(1001, "on_the_way", today, "08:00", "10:00"),
        job(1002, "confirmed", today, "10:00"),
        job(1004, "confirmed", "2026-10-27", "08:00", "10:00"),
        job(1000, "in_progress", "2026-10-25", "16:00", "18:00"),
        job(999, "completed", today, "08:00", "10:00"),
        job(998, "no_show", today, "08:00", "10:00"),
        // Finished on an earlier day: not shown.
        job(997, "completed", "2026-10-25", "08:00", "10:00"),
      ],
      today,
    );

    expect(groups.earlier.map((j) => j.number)).toEqual([1000]);
    expect(groups.today.date).toBe(today);
    expect(groups.today.slots.map((s) => s.jobs.map((j) => j.number))).toEqual([
      [1001],
      [1002, 1003],
    ]);
    expect(groups.tomorrow.date).toBe("2026-10-27");
    expect(groups.tomorrow.slots.map((s) => s.jobs.map((j) => j.number))).toEqual([[1004]]);
    expect(groups.done.map((j) => j.number)).toEqual([998, 999]);
    expect(isEmpty(groups)).toBe(false);
  });

  it("is empty without jobs", () => {
    expect(isEmpty(groupJobs([], today))).toBe(true);
  });
});

describe("crewJobErrorFor", () => {
  it("maps the database codes", () => {
    expect(crewJobErrorFor({ code: "ZL010" })).toBe("invalid_transition");
    expect(crewJobErrorFor({ code: "P0002", message: "order_not_found" })).toBe("not_found");
    expect(crewJobErrorFor({ code: "ZL011", message: "cash_not_collected" })).toBe(
      "cash_not_collected",
    );
    expect(crewJobErrorFor({ code: "ZL011", message: "reason_required" })).toBe("reason_required");
  });

  it("falls back to failed", () => {
    expect(crewJobErrorFor({ code: "ZL011", message: "before_photo_required" })).toBe("failed");
    expect(crewJobErrorFor({ code: "42501" })).toBe("failed");
    expect(crewJobErrorFor(null)).toBe("failed");
  });
});

describe("crew job schemas", () => {
  it("allows only the crew's own moves", () => {
    expect(advanceJobSchema.safeParse({ orderId: ID, toStatus: "arrived" }).success).toBe(true);
    expect(advanceJobSchema.safeParse({ orderId: ID, toStatus: "completed" }).success).toBe(false);
    expect(advanceJobSchema.safeParse({ orderId: ID, toStatus: "cancelled" }).success).toBe(false);
  });

  it("needs the cash tick to finish, unless the subscription covers the job", () => {
    const form = { orderId: ID, sterilant: "كلور", residualChlorine: null, note: "" };
    const ok = (patch: object) => finishJobSchema.safeParse({ ...form, ...patch }).success;
    expect(ok({ covered: false, cashCollected: true })).toBe(true);
    expect(ok({ covered: false, cashCollected: false })).toBe(false);
    expect(ok({ covered: true, cashCollected: false })).toBe(true);
  });

  it("needs a no-show note of at most 500 characters", () => {
    expect(crewNoShowSchema.safeParse({ orderId: ID, note: "  " }).success).toBe(false);
    expect(crewNoShowSchema.safeParse({ orderId: ID, note: "x".repeat(501) }).success).toBe(false);
    expect(crewNoShowSchema.parse({ orderId: ID, note: " ما فتحوا " }).note).toBe("ما فتحوا");
  });
});

describe("mapsLink", () => {
  it("opens the pin in Google Maps", () => {
    expect(mapsLink(32.616, 44.024)).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=32.616,44.024",
    );
  });
});
