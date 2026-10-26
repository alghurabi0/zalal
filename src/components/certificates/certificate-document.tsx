import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { LogoMark } from "@/components/brand/logo-mark";
import { textDir } from "@/lib/bidi";
import { certificateNumber, maskPhone } from "@/lib/certificates/format";
import type { CertificateData, CertificateFile } from "@/lib/certificates/queries";
import { formatDate, formatDay, slotParts } from "@/lib/dates";
import { formatPhone } from "@/lib/phone";

import { QrCode } from "./qr-code";

/**
 * The certificate as one A4 page (spec §10.1), printed to PDF by headless
 * Chromium. A company document: it must not look like a government or
 * health-authority certificate, so no seals or emblems beyond our logo and
 * the stamp box. The company name, stamp image and footer phone are still
 * open (spec §13): "شركة زلال", a dashed stamp box and settings.company_phone
 * (left out until it is set) stand in.
 */
export async function CertificateDocument({
  certificate,
  publicUrl,
}: {
  certificate: CertificateData;
  publicUrl: string;
}) {
  const t = await getTranslations("CertificateDoc");
  const tTanks = await getTranslations("Tanks");
  const tReport = await getTranslations("Report");
  const { order, customer } = certificate;
  const number = certificateNumber(order.number);
  const ltr = (text: string) => <span dir="ltr">{text}</span>;
  const photos = [
    ...certificate.before
      .filter(isPhoto)
      .slice(0, 2)
      .map((file) => ({ file, kind: "before" as const })),
    ...certificate.after
      .filter(isPhoto)
      .slice(0, 2)
      .map((file) => ({ file, kind: "after" as const })),
  ];

  return (
    <main
      data-certificate
      className="mx-auto flex min-h-dvh w-full max-w-200 flex-col gap-5 bg-surface px-12 py-11 text-navy"
    >
      <header className="flex items-start justify-between gap-6 border-b-2 border-navy pb-5">
        <div className="flex items-center gap-3.5">
          <span className="flex size-16 shrink-0 items-center justify-center rounded-input bg-navy">
            <LogoMark className="h-8 w-10" />
          </span>
          <div className="flex flex-col">
            <h1 className="text-24 leading-snug font-black">{t("title")}</h1>
            <span className="text-14 font-bold text-teal">{t("issuer")}</span>
          </div>
        </div>
        <dl className="flex shrink-0 flex-col gap-1 text-13">
          <div className="flex gap-2">
            <dt className="text-muted">{t("number")}</dt>
            <dd className="font-extrabold">{ltr(number)}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted">{t("issued")}</dt>
            <dd className="font-extrabold">{formatDate(certificate.issuedAt)}</dd>
          </div>
        </dl>
      </header>

      <div className="grid grid-cols-2 gap-4">
        <Block title={t("customer")}>
          {customer.name && <Row label={t("name")}>{customer.name}</Row>}
          <Row label={t("address")}>
            {t("addressValue", { district: order.district, landmark: order.landmark })}
          </Row>
          {customer.phone && <Row label={t("phone")}>{ltr(maskPhone(customer.phone))}</Row>}
        </Block>
        <Block title={t("service")}>
          <Row label={t("order")}>{ltr(`#${order.number}`)}</Row>
          <Row label={t("serviceDate")}>
            {t.rich("serviceDateValue", {
              date: formatDay(order.serviceDate),
              ...slotParts(order.slotStartAt, order.slotEndAt),
              num: (chunks) => <span dir="ltr">{chunks}</span>,
            })}
          </Row>
          <Row label={t("tanks")}>
            <ul>
              {order.tanks.map((tank, index) => (
                <li key={index}>
                  {tReport.rich("tank", {
                    type: tTanks(`types.${tank.tank_type}`),
                    size: tTanks(`sizes.${tank.size}`),
                    qty: tank.qty,
                    iso: (chunks) => (
                      <bdi dir={textDir(tTanks(`sizes.${tank.size}`))}>{chunks}</bdi>
                    ),
                  })}
                </li>
              ))}
            </ul>
          </Row>
          {certificate.sterilant && <Row label={t("sterilant")}>{certificate.sterilant}</Row>}
          {certificate.chlorine !== null && (
            <Row label={t("chlorine")}>
              {tReport("chlorineValue", { value: certificate.chlorine.toFixed(1) })}
            </Row>
          )}
        </Block>
      </div>

      {certificate.serviceText && (
        <Block title={t("description")}>
          <p className="text-13 leading-relaxed text-body-2">{certificate.serviceText}</p>
        </Block>
      )}

      {photos.length > 0 && (
        <Block title={t("photos")}>
          <ul className="grid grid-cols-4 gap-2.5">
            {photos.map(({ file, kind }) => (
              <li
                key={file.id}
                className="relative aspect-4/3 overflow-hidden rounded-chip bg-well"
              >
                {file.url && (
                  // Signed links that expire; the browser prints them once.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={file.url} alt="" className="size-full object-cover" />
                )}
                <span className="absolute start-1.5 top-1.5 rounded-8 bg-black/55 px-2 text-11 font-extrabold text-white">
                  {t(kind)}
                </span>
              </li>
            ))}
          </ul>
        </Block>
      )}

      <div className="grid grid-cols-4 gap-4">
        <div className="flex flex-col justify-center gap-1 rounded-card bg-selected p-4">
          <span className="text-13 font-bold text-muted">{t("next")}</span>
          <span className="text-18 font-black text-teal">{formatDay(certificate.nextDueOn)}</span>
        </div>
        <div className="col-span-2 flex items-center gap-4 rounded-card border border-border p-4">
          <QrCode value={publicUrl} label={t("qr")} className="size-28 shrink-0" />
          <div className="flex min-w-0 flex-col gap-1 text-12">
            <span className="text-14 font-extrabold">{t("verify")}</span>
            <span className="text-muted">{t("verifyBody")}</span>
            <span dir="ltr" className="text-start font-bold break-all">
              {publicUrl.replace(/^https?:\/\//, "")}
            </span>
            <span className="text-muted">
              {t("code")}:{" "}
              <span dir="ltr" className="font-extrabold text-navy">
                {certificate.publicCode}
              </span>
            </span>
          </div>
        </div>
        <div className="flex items-center justify-center rounded-card border-2 border-dashed border-track p-4">
          <span className="text-14 font-bold text-control-off">{t("stamp")}</span>
        </div>
      </div>

      <footer className="mt-auto flex flex-col gap-1 border-t border-border pt-3 text-12 text-muted">
        {certificate.companyPhone && (
          <span>
            {t("companyPhone")}: {ltr(formatPhone(certificate.companyPhone))}
          </span>
        )}
        <span>{t("disclaimer")}</span>
      </footer>
    </main>
  );
}

function isPhoto(file: CertificateFile): boolean {
  return file.mediaType === "photo" && file.url !== null;
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-card border border-border p-4">
      <h2 className="text-15 font-extrabold">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 text-13">
      <span className="w-24 shrink-0 text-muted">{label}</span>
      <span className="min-w-0 flex-1 font-bold">{children}</span>
    </div>
  );
}
