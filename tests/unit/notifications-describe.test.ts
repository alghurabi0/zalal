import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";

import messages from "../../messages/ar.json";
import {
  describeNotification,
  notificationHref,
  type NotificationInput,
} from "@/lib/notifications/describe";

// What each notification says and where it opens (spec §9.2), rendered with
// the real ar.json the way the service worker does (plain text, numbers
// isolated left-to-right).

const t = createTranslator({ locale: "ar", messages, namespace: "Notifications" });
const LRI = "⁦";
const PDI = "⁩";
const plain = (s: string) => s.replaceAll(LRI, "").replaceAll(PDI, "");

function render(type: string, data: unknown) {
  const { item, values } = describeNotification({ type, data }, t);
  const num = (chunks: string) => `${LRI}${chunks}${PDI}`;
  return {
    item,
    title: plain(t.markup(`items.${item}.title`, { ...values, num })),
    body: plain(t.markup(`items.${item}.body`, { ...values, num })),
    rawTitle: t.markup(`items.${item}.title`, { ...values, num }),
  };
}

const order = {
  number: 1024,
  service_date: "2026-10-29",
  // 9–11 in the morning, Baghdad (UTC+3).
  slot_start_at: "2026-10-29T06:00:00+00:00",
  slot_end_at: "2026-10-29T08:00:00+00:00",
  district: "حي الحسين",
};
const when = "الخميس 29 · 9–11 الصبح";

const input = (type: string, extra: Partial<NotificationInput> = {}): NotificationInput => ({
  type,
  data: {},
  orderId: "o-1",
  ticketId: "t-1",
  ...extra,
});

describe("describeNotification", () => {
  it.each([
    ["order_confirmed", order, "تأكد حجزك", `طلب #1024 · ${when}`],
    ["order_rescheduled", order, "تغيّر موعد طلبك #1024", `الموعد الجديد: ${when}`],
    ["order_cancelled", order, "انلغى طلبك #1024", "إذا عندك سؤال راسلنا بالمحادثة."],
    ["crew_on_the_way", order, "الفريق طلع لبيتك", "طلب #1024 · تابعهم على الخريطة."],
    ["crew_arrived", order, "الفريق وصل", "طلب #1024 · الفريق يمك هسه."],
    ["work_started", order, "بدأ الشغل", "طلب #1024 · تكدر تشوف الصور أول بأول."],
    ["order_completed", order, "شهادة التعقيم جاهزة", "طلب #1024 · شوف الشهادة وقيّم الشغل."],
    ["order_no_show", order, "ما لكينا أحد بالبيت", "طلب #1024 · راسلنا حتى نرتب موعد ثاني."],
    [
      "order_postponed",
      order,
      "تأجل طلبك #1024",
      "نحدد وياك موعد جديد بعدين. إذا عندك سؤال راسلنا بالمحادثة.",
    ],
    ["customer_postponed", order, "الزبون أجّل طلب #1024", `كان موعده ${when} · يحتاج موعد جديد`],
    ["new_booking", order, "حجز جديد #1024", `${when} · حي الحسين`],
    [
      "customer_rescheduled",
      order,
      "الزبون غيّر موعد طلب #1024",
      `الموعد الجديد: ${when} · يحتاج تأكيد`,
    ],
    [
      "customer_cancelled",
      { ...order, cancel_reason: "time_unsuitable" },
      "الزبون ألغى طلب #1024",
      "السبب: الموعد ما يناسبني",
    ],
    ["new_job", order, "شغلة جديدة #1024", `${when} · حي الحسين`],
    ["job_changed", { ...order, change: "cancelled" }, "تغيّرت شغلة #1024", "انلغت."],
    ["job_changed", { ...order, change: "reassigned" }, "تغيّرت شغلة #1024", "انطت لفريق ثاني."],
    ["job_changed", { ...order, change: "removed" }, "تغيّرت شغلة #1024", "انشالت من جدولكم."],
    ["support_message", { excerpt: "تم تأكيد الموعد" }, "رد جديد من الدعم", "تم تأكيد الموعد"],
    ["support_message", { media_type: "photo" }, "رد جديد من الدعم", "أرسل لك صورة"],
    [
      "customer_message",
      { excerpt: "وين الفريق؟", thread_id: "00000000-0000-4000-8000-000000000001" },
      "رسالة جديدة من زبون",
      "وين الفريق؟",
    ],
    ["customer_message", { media_type: "video" }, "رسالة جديدة من زبون", "أرسل فيديو"],
    ["customer_message", { topic: "price" }, "رسالة جديدة من زبون", "عنده استفسار عن سعر"],
    [
      "ticket_status",
      { ticket_number: 1001, status: "in_progress" },
      "بلاغك ZL-T-1001 صار قيد المعالجة",
      "الردود توصلك بالمحادثة.",
    ],
    [
      "ticket_status",
      { ticket_number: 1001, status: "closed" },
      "انغلق بلاغك ZL-T-1001",
      "الردود توصلك بالمحادثة.",
    ],
    [
      "new_ticket",
      { ticket_number: 1001, source: "app", category: "leak", order_number: 1024 },
      "بلاغ جديد ZL-T-1001",
      "تسريب بعد التنظيف · طلب #1024",
    ],
    [
      "new_ticket",
      { ticket_number: 1002, source: "app", category: "payment" },
      "بلاغ جديد ZL-T-1002",
      "مشكلة بالدفع · بدون طلب",
    ],
    [
      "new_ticket",
      { ticket_number: 1003, source: "rating", stars: 2, order_number: 1024 },
      "بلاغ جديد ZL-T-1003",
      "تقييم 2 من 5 · طلب #1024",
    ],
    [
      "cleaning_reminder",
      { kind: "due", due_on: "2026-11-01", months: 6, label: "home" },
      "تذكير بموعد التنظيف",
      "مرت 6 أشهر على آخر تنظيف لخزان البيت.",
    ],
    [
      "cleaning_reminder",
      { kind: "week", due_on: "2026-11-08", months: 6, label: "family" },
      "تذكير بموعد التنظيف",
      "موعد التنظيف الجاي لخزان بيت الأهل يوم 8 تشرين الثاني.",
    ],
    [
      "stock_low",
      { item_id: "i-1", name: "كلور", unit: "كيلو", quantity: 1250.5 },
      "كلور ناقص بالمخزن",
      "باقي 1,250.5 كيلو",
    ],
    [
      "subscription_requested",
      { subscription_id: "s-1", label: "home", district: "حي الحسين" },
      "طلب اشتراك جديد",
      "البيت · حي الحسين",
    ],
    [
      "subscription_activated",
      {
        subscription_id: "s-1",
        label: "home",
        district: "حي الحسين",
        visits: 2,
        ends_on: "2027-10-27",
      },
      "تفعّل اشتراكك السنوي",
      "اشتراك البيت: زيارتين لحد 27 تشرين الأول 2027.",
    ],
    [
      "subscription_expiring",
      {
        subscription_id: "s-1",
        label: "family",
        district: "حي الحسين",
        visits: 2,
        ends_on: "2027-10-27",
      },
      "اشتراكك يخلص قريباً",
      "اشتراك بيت الأهل ينتهي يوم 27 تشرين الأول 2027. تكدر تجدده هسه.",
    ],
    [
      "subscription_declined",
      { subscription_id: "s-1", label: "home", district: "حي الحسين" },
      "ما كدرنا نفعّل اشتراكك",
      "راسلنا بالمحادثة إذا عندك سؤال.",
    ],
  ])("%s %j", (type, data, title, body) => {
    const rendered = render(type, data);
    expect(rendered.title).toBe(title);
    expect(rendered.body).toBe(body);
  });

  it("keeps order and ticket numbers left to right inside the Arabic text", () => {
    expect(render("order_rescheduled", order).rawTitle).toBe(`تغيّر موعد طلبك ${LRI}#1024${PDI}`);
  });

  it("falls back to a generic notification for an unknown type or broken data", () => {
    expect(render("subscription_activated", {}).item).toBe("unknown");
    expect(render("subscription_activated", { label: "home", ends_on: "soon" }).item).toBe(
      "unknown",
    );
    expect(render("order_confirmed", { number: "1024" }).item).toBe("unknown");
    expect(render("support_message", {}).item).toBe("unknown");
    expect(render("unknown", {}).title).toBe("عندك إشعار جديد");
  });
});

describe("notificationHref", () => {
  it.each([
    ["order_confirmed", "/orders/o-1"],
    ["order_cancelled", "/orders/o-1"],
    ["order_postponed", "/orders/o-1"],
    ["customer_postponed", "/admin/orders?order=o-1"],
    ["crew_on_the_way", "/orders/o-1/track"],
    ["crew_arrived", "/orders/o-1/live"],
    ["work_started", "/orders/o-1/live"],
    ["order_completed", "/orders/o-1/certificate"],
    ["order_no_show", "/chat?order=o-1"],
    ["support_message", "/chat"],
    ["ticket_status", "/reports/t-1"],
    ["cleaning_reminder", "/book"],
    ["new_booking", "/admin/orders?order=o-1"],
    ["customer_cancelled", "/admin/orders?order=o-1"],
    ["new_ticket", "/admin/tickets?ticket=t-1"],
    ["new_job", "/crew/jobs/o-1"],
    ["job_changed", "/crew"],
    ["something_new", "/notifications"],
  ])("%s opens %s", (type, href) => {
    expect(notificationHref(input(type))).toBe(href);
  });

  it("opens a subscription on N8, A7 or Chat", () => {
    const data = {
      subscription_id: "00000000-0000-4000-8000-0000000000aa",
      address_id: "00000000-0000-4000-8000-0000000000bb",
    };
    expect(notificationHref(input("subscription_activated", { data }))).toBe(
      "/subscription?address=00000000-0000-4000-8000-0000000000bb",
    );
    expect(notificationHref(input("subscription_expiring", { data }))).toBe(
      "/subscription?address=00000000-0000-4000-8000-0000000000bb",
    );
    expect(notificationHref(input("subscription_expiring"))).toBe("/subscription");
    expect(notificationHref(input("subscription_declined", { data }))).toBe("/chat");
    expect(notificationHref(input("subscription_requested", { data }))).toBe(
      "/admin/subscriptions?subscription=00000000-0000-4000-8000-0000000000aa",
    );
  });

  it("opens the item's drawer on A23 for low stock", () => {
    expect(
      notificationHref(
        input("stock_low", { data: { item_id: "00000000-0000-4000-8000-0000000000cc" } }),
      ),
    ).toBe("/admin/finance/stock?item=00000000-0000-4000-8000-0000000000cc");
    expect(notificationHref(input("stock_low"))).toBe("/admin/finance/stock");
  });

  it("opens the admin's conversation for a customer's message", () => {
    expect(
      notificationHref(
        input("customer_message", { data: { thread_id: "00000000-0000-4000-8000-000000000001" } }),
      ),
    ).toBe("/admin/chat/00000000-0000-4000-8000-000000000001");
    expect(notificationHref(input("customer_message"))).toBe("/admin/chat");
  });
});
