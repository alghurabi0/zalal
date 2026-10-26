// @vitest-environment happy-dom
import { renderToStaticMarkup } from "react-dom/server";
import { encode } from "uqr";
import { describe, expect, it } from "vitest";

import { QrCode } from "@/components/certificates/qr-code";

describe("QrCode", () => {
  it("draws every dark module of the code as one navy path", () => {
    const value = "https://zalal.iq/c/H3JW3NK9";
    const html = renderToStaticMarkup(<QrCode value={value} label="رمز QR" className="size-28" />);
    const { data, size } = encode(value, { ecc: "M", border: 2 });
    const dark = data.flat().filter(Boolean).length;

    expect(html).toContain(`viewBox="0 0 ${size} ${size}"`);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="رمز QR"');
    expect(html).toContain('class="fill-navy"');
    expect(html.match(/h1v1h-1z/g)).toHaveLength(dark);
  });
});
