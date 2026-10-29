// @vitest-environment happy-dom
import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DaySlotPicker } from "@/components/booking/day-slot-picker";
import type { DayOption } from "@/lib/booking/availability";

import messages from "../../messages/ar.json";

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

function render(showRemaining?: boolean) {
  const template = document.createElement("template");
  template.innerHTML = renderToStaticMarkup(
    <NextIntlClientProvider locale="ar" messages={messages} timeZone="Asia/Baghdad">
      <DaySlotPicker
        days={days}
        serviceDate="2026-10-31"
        slotId={null}
        onDayChange={() => {}}
        onSlotChange={() => {}}
        showRemaining={showRemaining}
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
});
