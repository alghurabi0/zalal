// @vitest-environment happy-dom
import { NextIntlClientProvider } from "next-intl";
import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import messages from "../../messages/ar.json";

const captureException = vi.fn();
vi.mock("@sentry/nextjs", () => ({ captureException }));
// next/font only works inside the Next.js compiler.
vi.mock("@/lib/fonts", () => ({ cairo: { variable: "font-cairo" } }));

const { default: RootError } = await import("@/app/error");
const { default: GlobalError } = await import("@/app/global-error");

function withIntl(ui: ReactElement) {
  return (
    <NextIntlClientProvider locale="ar" messages={messages} timeZone="Asia/Baghdad">
      {ui}
    </NextIntlClientProvider>
  );
}

function render(html: string) {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template.content;
}

describe("error screens", () => {
  it("app/error.tsx shows the error state with اعد المحاولة, which retries", () => {
    const retry = vi.fn();
    const container = document.createElement("div");
    const root = createRoot(container);
    act(() => root.render(withIntl(<RootError error={new Error("boom")} retry={retry} />)));

    expect(container.querySelector("h1")?.textContent).toBe(messages.UI.errorTitle);
    const button = container.querySelector("button");
    expect(button?.textContent).toBe(messages.UI.retry);
    act(() => button?.click());
    expect(retry).toHaveBeenCalledOnce();
    act(() => root.unmount());
  });

  it("both report the error to Sentry", () => {
    captureException.mockClear();
    const error = new Error("boom");
    const container = document.createElement("div");
    const root = createRoot(container);
    act(() => root.render(withIntl(<RootError error={error} retry={() => {}} />)));
    expect(captureException).toHaveBeenCalledWith(error);
    act(() => root.unmount());

    // global-error.tsx renders its own <html>, so mount it in a document.
    captureException.mockClear();
    const doc = document.implementation.createHTMLDocument();
    const globalRoot = createRoot(doc);
    act(() => globalRoot.render(<GlobalError error={error} retry={() => {}} />));
    expect(captureException).toHaveBeenCalledWith(error);
    act(() => globalRoot.unmount());
  });

  it("global-error.tsx brings its own Arabic, right-to-left document", () => {
    const html = renderToStaticMarkup(<GlobalError error={new Error("boom")} retry={() => {}} />);
    expect(html).toMatch(/^<html lang="ar" dir="rtl" class="font-cairo">/);

    const page = render(html.replace(/^<html[^>]*>|<\/html>$/g, ""));
    expect(page.querySelector("h1")?.textContent).toBe(messages.UI.errorTitle);
    expect(page.querySelector("button")?.textContent).toBe(messages.UI.retry);
  });
});
