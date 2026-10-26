import { getTranslations } from "next-intl/server";

import { textDir } from "@/lib/bidi";
import type { CertificateTank } from "@/lib/certificates/queries";

/**
 * One tank line of a certificate ("خزان سطح · 1,000–2,000 × 2"), the same
 * on Report, N15 and the PDF. The size is isolated so a numeric range keeps
 * its order inside the RTL line.
 */
export async function TankLine({ tank }: { tank: CertificateTank }) {
  const t = await getTranslations("Report");
  const tTanks = await getTranslations("Tanks");
  const size = tTanks(`sizes.${tank.size}`);
  return t.rich("tank", {
    type: tTanks(`types.${tank.tank_type}`),
    size,
    qty: tank.qty,
    iso: (chunks) => <bdi dir={textDir(size)}>{chunks}</bdi>,
  });
}
