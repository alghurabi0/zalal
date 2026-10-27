import { describe, expect, it } from "vitest";

import { pushMessage } from "@/lib/notifications/push-message";

// What the service worker shows for a push (spec §9.2): the same words as the
// in-app list, plain text with numbers kept left to right, a tag that
// collapses chat pushes, and the URL that marks it read on tap.

const LRI = "⁦";
const PDI = "⁩";
const id = "00000000-0000-4000-8000-0000000000a1";
const orderId = "00000000-0000-4000-8000-0000000000b1";
const thread = "00000000-0000-4000-8000-0000000000c1";

describe("pushMessage", () => {
  it("writes an order event from its values", () => {
    expect(
      pushMessage({
        id,
        type: "crew_on_the_way",
        data: {
          number: 1024,
          service_date: "2026-10-29",
          slot_start_at: "2026-10-29T06:00:00+00:00",
          slot_end_at: "2026-10-29T08:00:00+00:00",
          district: "حي الحسين",
        },
        orderId,
        ticketId: null,
      }),
    ).toEqual({
      title: "الفريق طلع لبيتك",
      body: `طلب ${LRI}#1024${PDI} · تابعهم على الخريطة.`,
      tag: id,
      url: `/notifications/${id}`,
    });
  });

  it("collapses the customer's chat pushes into one, and an admin's per conversation", () => {
    const support = pushMessage({
      id,
      type: "support_message",
      data: { excerpt: "هلا" },
      orderId: null,
      ticketId: null,
    });
    expect(support.tag).toBe("chat");
    expect(support.body).toBe("هلا");
    expect(
      pushMessage({
        id,
        type: "customer_message",
        data: { excerpt: "هلا", thread_id: thread },
        orderId: null,
        ticketId: null,
      }).tag,
    ).toBe(`chat-${thread}`);
  });

  it.each([
    [null],
    ["text"],
    [{ id: "not-a-uuid", type: "order_confirmed", data: {}, orderId: null, ticketId: null }],
    [{ id, type: "order_confirmed", data: [], orderId: null, ticketId: null }],
    [{ id, type: "order_confirmed", data: {}, orderId: "x", ticketId: null }],
  ])("shows a generic notification for an unreadable payload %j", (payload) => {
    expect(pushMessage(payload)).toEqual({
      title: "عندك إشعار جديد",
      body: "افتح التطبيق حتى تشوف التفاصيل.",
      tag: "zalal",
      url: "/",
    });
  });

  it("a newer app type the worker doesn't know yet still opens the notification", () => {
    const message = pushMessage({
      id,
      type: "subscription_activated",
      data: {},
      orderId: null,
      ticketId: null,
    });
    expect(message.title).toBe("عندك إشعار جديد");
    expect(message.url).toBe(`/notifications/${id}`);
  });
});
