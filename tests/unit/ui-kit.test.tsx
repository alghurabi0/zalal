// @vitest-environment happy-dom
import { ChevronLeft } from "lucide-react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BackButton } from "@/components/ui/back-button";
import { Button } from "@/components/ui/button";
import { Chip, ChipGroup } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { SkeletonGroup } from "@/components/ui/skeleton";
import { StepProgress } from "@/components/ui/step-progress";
import { Stepper } from "@/components/ui/stepper";
import { TabBar } from "@/components/ui/tab-bar";

import messages from "../../messages/ar.json";

/** Renders to a detached DOM so tests can query it like a page. */
function render(ui: ReactElement) {
  const html = renderToStaticMarkup(
    <NextIntlClientProvider locale="ar" messages={messages} timeZone="Asia/Baghdad">
      {ui}
    </NextIntlClientProvider>,
  );
  const template = document.createElement("template");
  template.innerHTML = html;
  return template.content;
}

describe("Button", () => {
  it("is a type=button by default and a link when given href", () => {
    expect(render(<Button>التالي</Button>).querySelector("button")?.type).toBe("button");
    const link = render(<Button href="/book">التالي</Button>).querySelector("a");
    expect(link?.getAttribute("href")).toBe("/book");
  });

  it("turns grey when disabled", () => {
    const button = render(<Button disabled>التالي</Button>).querySelector("button");
    expect(button?.disabled).toBe(true);
    expect(button?.className).toContain("bg-disabled");
  });

  it("keeps its colors, label and a spinner while loading", () => {
    const button = render(<Button loading>التالي</Button>).querySelector("button");
    expect(button?.disabled).toBe(true);
    expect(button?.getAttribute("aria-busy")).toBe("true");
    expect(button?.className).toContain("bg-navy");
    expect(button?.textContent).toBe("التالي");
    expect(button?.querySelector("svg")).not.toBeNull();
  });

  it("renders a disabled link as a disabled button", () => {
    const fragment = render(
      <Button href="/book" disabled>
        التالي
      </Button>,
    );
    expect(fragment.querySelector("a")).toBeNull();
    expect(fragment.querySelector("button")?.disabled).toBe(true);
  });

  it("lets className override the size's radius and font size", () => {
    const button = render(
      <Button size="card" className="rounded-button text-15">
        التالي
      </Button>,
    ).querySelector("button");
    expect(button?.className).toContain("rounded-button");
    expect(button?.className).not.toContain("rounded-input");
    expect(button?.className).toContain("text-15");
    expect(button?.className).not.toContain("text-16");
  });
});

describe("IconButton", () => {
  it("uses its label as the accessible name and hides the glyph", () => {
    const button = render(<IconButton label="اتصال" icon={ChevronLeft} />).querySelector("button");
    expect(button?.getAttribute("aria-label")).toBe("اتصال");
    expect(button?.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("requires a label", () => {
    // @ts-expect-error: label is required for icon-only buttons.
    render(<IconButton icon={ChevronLeft} />);
  });

  it("BackButton links back with the Arabic label", () => {
    const link = render(<BackButton href="/" />).querySelector("a");
    expect(link?.getAttribute("aria-label")).toBe(messages.UI.back);
    expect(link?.getAttribute("href")).toBe("/");
  });
});

describe("Chip", () => {
  it("is a real radio input inside its label, inside a fieldset", () => {
    const fragment = render(
      <ChipGroup legend="السعة">
        <Chip type="radio" name="size" value="m" defaultChecked>
          1,000–2,000
        </Chip>
      </ChipGroup>,
    );
    expect(fragment.querySelector("fieldset legend")?.textContent).toBe("السعة");
    const input = fragment.querySelector<HTMLInputElement>("label > input");
    expect(input?.type).toBe("radio");
    expect(input?.name).toBe("size");
    expect(input?.value).toBe("m");
    expect(input?.defaultChecked).toBe(true);
  });
});

describe("Field", () => {
  it("connects the label and the hint to the control", () => {
    const fragment = render(
      <Field label="رقم الموبايل" hint="مثال" id="phone">
        {(control) => <Input {...control} />}
      </Field>,
    );
    expect(fragment.querySelector("label")?.getAttribute("for")).toBe("phone");
    const input = fragment.querySelector("input");
    expect(input?.id).toBe("phone");
    expect(input?.getAttribute("aria-invalid")).toBeNull();
    const message = fragment.getElementById(input?.getAttribute("aria-describedby") ?? "");
    expect(message?.textContent).toBe("مثال");
  });

  it("marks the control invalid and shows the error instead of the hint", () => {
    const fragment = render(
      <Field label="رقم الموبايل" hint="مثال" error="رقم غلط" id="phone">
        {(control) => <Input {...control} />}
      </Field>,
    );
    const input = fragment.querySelector("input");
    expect(input?.getAttribute("aria-invalid")).toBe("true");
    expect(fragment.getElementById("phone-message")?.textContent).toBe("رقم غلط");
  });
});

describe("TabBar", () => {
  it("marks the active tab and links the center button to Booking", () => {
    const nav = render(<TabBar active="orders" />).querySelector("nav");
    expect(nav?.getAttribute("aria-label")).toBe(messages.UI.tabs.label);
    const current = nav?.querySelectorAll('[aria-current="page"]');
    expect(current?.length).toBe(1);
    expect(current?.[0]?.getAttribute("href")).toBe("/orders");
    expect(current?.[0]?.textContent).toBe(messages.UI.tabs.orders);
    const links = [...(nav?.querySelectorAll("a") ?? [])].map((a) => a.getAttribute("href"));
    expect(links).toEqual(["/", "/orders", "/book", "/chat", "/profile"]);
  });

  it("announces unread chat messages", () => {
    const chat = render(<TabBar chatUnread />).querySelector('a[href="/chat"]');
    expect(chat?.textContent).toContain(messages.UI.tabs.chatUnread);
  });
});

describe("Stepper", () => {
  it("names the group and the buttons, submits its value and blocks going below min", () => {
    const fragment = render(<Stepper label="عدد الخزانات" name="count" defaultValue={1} max={6} />);
    expect(fragment.querySelector('[role="group"]')?.getAttribute("aria-label")).toBe(
      "عدد الخزانات",
    );
    const [dec, inc] = fragment.querySelectorAll("button");
    expect(dec?.getAttribute("aria-label")).toBe(messages.UI.decrease);
    expect(dec?.getAttribute("aria-disabled")).toBe("true");
    expect(inc?.getAttribute("aria-label")).toBe(messages.UI.increase);
    expect(inc?.getAttribute("aria-disabled")).toBeNull();
    expect(fragment.querySelector("output")?.textContent).toBe("1");
    expect(fragment.querySelector<HTMLInputElement>('input[name="count"]')?.value).toBe("1");
  });

  it("blocks going above max", () => {
    const [, inc] = render(<Stepper label="عدد" value={6} max={6} />).querySelectorAll("button");
    expect(inc?.getAttribute("aria-disabled")).toBe("true");
  });
});

describe("StepProgress", () => {
  it("fills bars up to the current step and hides them from screen readers", () => {
    const bars = render(<StepProgress steps={3} current={2} />).firstElementChild;
    expect(bars?.getAttribute("aria-hidden")).toBe("true");
    const fills = [...(bars?.children ?? [])].map((b) => b.className.includes("bg-navy"));
    expect(fills).toEqual([true, true, false]);
  });

  it("marks the step in progress in a labelled list", () => {
    const items = render(
      <StepProgress steps={["تأكد", "بالطريق", "وصل", "خلص"]} current={2} />,
    ).querySelectorAll("li");
    expect(items.length).toBe(4);
    expect(items[1]?.getAttribute("aria-current")).toBe("step");
    expect(items[0]?.querySelector("span")?.className).toContain("bg-navy");
    expect(items[1]?.querySelector("span")?.className).toContain("bg-aqua");
    expect(items[2]?.querySelector("span")?.className).toContain("bg-border");
  });
});

describe("SkeletonGroup and EmptyState", () => {
  it("SkeletonGroup announces loading once", () => {
    const status = render(<SkeletonGroup>x</SkeletonGroup>).querySelector('[role="status"]');
    expect(status?.textContent).toContain(messages.UI.loading);
  });

  it("EmptyState shows a heading, text and action", () => {
    const fragment = render(
      <EmptyState
        icon={ChevronLeft}
        title="ماكو إشعارات"
        description="نص"
        action={<Button>رجوع</Button>}
      />,
    );
    expect(fragment.querySelector("h2")?.textContent).toBe("ماكو إشعارات");
    expect(fragment.querySelector("p")?.textContent).toBe("نص");
    expect(fragment.querySelector("button")?.textContent).toBe("رجوع");
  });
});
