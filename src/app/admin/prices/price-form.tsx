"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { AdminEditError } from "@/lib/admin/edit-errors";
import type { PriceTable } from "@/lib/booking/draft";
import { formatIQD } from "@/lib/money";
import { parsePrice, PRICE_MAX } from "@/lib/schemas/admin-catalog";
import { tankSizes, tankTypes } from "@/lib/schemas/tank";

import { savePrices } from "./actions";

/** The A8 grid: one input per tank type and size, saved together. */
export function PriceForm({ prices }: { prices: PriceTable }) {
  const t = useTranslations("Admin.prices");
  const tTanks = useTranslations("Tanks");
  const tUI = useTranslations("UI");
  const tErrors = useTranslations("Admin.editErrors");
  const router = useRouter();
  const [values, setValues] = useState(() =>
    Object.fromEntries(
      tankTypes.flatMap((type) =>
        tankSizes.map((size) => [`${type}/${size}`, String(prices[type][size])]),
      ),
    ),
  );
  const [error, setError] = useState<AdminEditError | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const cells = tankTypes.flatMap((type) =>
    tankSizes.map((size) => ({ type, size, price: parsePrice(values[`${type}/${size}`] ?? "") })),
  );
  const invalid = cells.some((cell) => cell.price === null);

  const save = () => {
    setError(null);
    setSaved(false);
    if (invalid) return;
    startTransition(async () => {
      const result = await savePrices(
        cells.map((cell) => ({ type: cell.type, size: cell.size, price: cell.price ?? 0 })),
      );
      if (result.status === "done") {
        setSaved(true);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <form
      className="flex max-w-3xl flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-14">
          <caption className="sr-only">{t("caption")}</caption>
          <thead className="bg-well text-13">
            <tr>
              <th scope="col" className="px-4 py-2.5 text-start font-bold text-muted">
                {t("type")}
              </th>
              {tankSizes.map((size) => (
                <th key={size} scope="col" className="px-3 py-2.5 text-start font-bold">
                  {tTanks(`sizes.${size}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tankTypes.map((type) => (
              <tr key={type} className="border-t border-divider">
                <th scope="row" className="px-4 py-3 text-start font-extrabold">
                  {tTanks(`types.${type}`)}
                </th>
                {tankSizes.map((size) => {
                  const key = `${type}/${size}`;
                  const price = parsePrice(values[key] ?? "");
                  return (
                    <td key={size} className="px-3 py-3 align-top">
                      <Input
                        variant="compact"
                        inputMode="numeric"
                        dir="ltr"
                        className="text-start"
                        name={key}
                        aria-label={t("cellLabel", {
                          type: tTanks(`types.${type}`),
                          size: tTanks(`sizes.${size}`),
                        })}
                        aria-invalid={price === null ? true : undefined}
                        value={values[key] ?? ""}
                        onChange={(event) => {
                          setSaved(false);
                          setValues((v) => ({ ...v, [key]: event.target.value }));
                        }}
                      />
                      <span className="mt-1 block text-12 text-muted">
                        {price === null
                          ? t("invalid", { max: formatIQD(PRICE_MAX) })
                          : tUI("iqd", { amount: formatIQD(price) })}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="card" loading={pending} disabled={invalid}>
          {t("save")}
        </Button>
        <p role="status" className="text-14 font-bold">
          {error ? (
            <span className="text-danger">{tErrors(error)}</span>
          ) : saved ? (
            <span className="text-ok-fg">{t("saved")}</span>
          ) : null}
        </p>
      </div>
    </form>
  );
}
