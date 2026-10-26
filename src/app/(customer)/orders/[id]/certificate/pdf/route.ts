import * as Sentry from "@sentry/nextjs";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getViewer } from "@/lib/auth/viewer";
import { certificateNumber } from "@/lib/certificates/format";
import { printOrigin } from "@/lib/certificates/origins";
import { ensureCertificatePdf } from "@/lib/certificates/pdf";
import { certificateEnv } from "@/lib/env.server";
import { routes, withNext } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";

// Chromium starts cold and prints the page when the PDF isn't stored yet.
export const maxDuration = 60;

/**
 * "تحميل الشهادة PDF" (spec §5.15): sends the browser to a signed link that
 * downloads the stored PDF as ZL-1024.pdf, making the PDF first if it is
 * missing (an admin override completed the order, or the run after the
 * crew's completion failed). The customer of the order and admins only:
 * the certificate is read as the viewer, so RLS decides.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/orders/[id]/certificate/pdf">) {
  const { id } = await ctx.params;
  const orderId = z.uuid().safeParse(id);
  if (!orderId.success) return new NextResponse(null, { status: 404 });
  const report = new URL(routes.certificate(orderId.data), request.url);

  const viewer = await getViewer();
  if (!viewer) {
    return NextResponse.redirect(
      new URL(withNext(routes.login, routes.certificate(orderId.data)), request.url),
      303,
    );
  }

  const supabase = await createClient();
  const { data: certificate, error } = await supabase
    .from("certificates")
    .select("id, orders!inner(number, status)")
    .eq("order_id", orderId.data)
    .eq("orders.status", "completed")
    .maybeSingle();
  if (error) throw new Error(`Certificate read failed: ${error.message}`);
  if (!certificate) return NextResponse.redirect(report, 303);

  let path: string | null;
  try {
    const origin = printOrigin(
      certificateEnv(),
      request.headers.get("host"),
      request.headers.get("x-forwarded-proto"),
    );
    if (!origin) throw new Error("No origin to print the certificate from");
    path = await ensureCertificatePdf(certificate.id, origin);
  } catch (pdfError) {
    Sentry.captureException(pdfError);
    report.searchParams.set("pdf", "failed");
    return NextResponse.redirect(report, 303);
  }
  if (!path) return NextResponse.redirect(report, 303);

  const { data: signed, error: signError } = await supabase.storage
    .from("certificates")
    .createSignedUrl(path, 60 * 60, {
      download: `${certificateNumber(certificate.orders.number)}.pdf`,
    });
  if (signError) throw new Error(`Signing failed: ${signError.message}`);
  return NextResponse.redirect(signed.signedUrl, 303);
}
