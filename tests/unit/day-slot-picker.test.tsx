// @vitest-environment happy-dom
import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { DaySlotPicker } from "@/components/booking/day-slot-picker";
import type { DayOption } from "@/lib/booking/availability";

import messages from "../../messages/ar.json";

// The month calendar reads days through a Server Action; nothing opens it here.
vi.mock("@/app/(customer)/book/actions", () => ({ loadBookingDays: vi.fn() }));

const days: DayOption[] = [
  {
    date: "2026-10-31",
    full: false,
    slots: [
      {
        slotId: 1,
        startAt: "2026-10-31T05:00:00Z",
        endAt: "2026-10-31T07:00:00Z",
        remaining: 2,
        bookable: true,
      },
      {
        slotId: 2,
        startAt: "2026-10-31T07:00:00Z",
        endAt: "2026-10-31T09:00:00Z",
        remaining: 0,
        bookable: false,
      },
    ],
  },
];

function render(showRemaining?: boolean, { otherDay = false, empty = false } = {}) {
  const template = document.createElement("template");
  template.innerHTML = renderToStaticMarkup(
    <NextIntlClientProvider locale="ar" messages={messages} timeZone="Asia/Baghdad">
      <DaySlotPicker
        days={empty ? [] : days}
        serviceDate="2026-10-31"
        slotId={null}
        onDayChange={() => {}}
        onSlotChange={() => {}}
        showRemaining={showRemaining}
        onOtherDay={otherDay ? () => {} : undefined}
      />
    </NextIntlClientProvider>,
  );
  return template.content;
}

const slotLabels = (root: DocumentFragment) =>
  [...root.querySelectorAll("label")].map((label) => label.textContent ?? "").slice(-2);

describe("DaySlotPicker", () => {
  it("hides the places left from customers but still marks a full slot", () => {
    const [open, full] = slotLabels(render());
    expect(open).not.toContain("باقي");
    expect(full).toContain(messages.Booking.slotFull);
  });

  it("shows the places left when asked (the admin's reschedule)", () => {
    const [open] = slotLabels(render(true));
    expect(open).toContain("باقي مكانين");
  });

  it("ends the days with a closed month calendar for customers", () => {
    const other = (root: DocumentFragment) =>
      [...root.querySelectorAll("button")].find(
        (button) => button.textContent === messages.Booking.calendar.open,
      );
    expect(other(render())).toBeUndefined();
    expect(other(render(false, { otherDay: true }))?.getAttribute("aria-expanded")).toBe("false");
    const empty = render(false, { otherDay: true, empty: true });
    expect(empty.textContent).toContain(messages.Booking.noDaysOther);
    expect(other(empty)).toBeDefined();
  });
});
