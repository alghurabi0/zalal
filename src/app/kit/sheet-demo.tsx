"use client";

import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Chip, ChipGroup } from "@/components/ui/chip";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet, SheetClose, SheetContent, SheetTrigger } from "@/components/ui/sheet";

export function SheetDemo() {
  const t = useTranslations("Kit");

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="secondary" size="md">
          {t("openSheet")}
        </Button>
      </SheetTrigger>
      <SheetContent title={t("sheetTitle")} description={t("sheetBody")}>
        <Field label={t("district")} variant="compact">
          {(control) => <Input {...control} variant="compact" />}
        </Field>
        <Field label={t("landmark")} variant="compact">
          {(control) => (
            <Input {...control} variant="compact" placeholder={t("landmarkPlaceholder")} />
          )}
        </Field>
        <ChipGroup legend={<span className="sr-only">{t("labelLegend")}</span>}>
          <Chip type="radio" variant="pill" name="sheet-label" value="home" defaultChecked>
            {t("labelHome")}
          </Chip>
          <Chip type="radio" variant="pill" name="sheet-label" value="family">
            {t("labelFamily")}
          </Chip>
          <Chip type="radio" variant="pill" name="sheet-label" value="work">
            {t("labelWork")}
          </Chip>
        </ChipGroup>
        <SheetClose asChild>
          <Button>{t("saveAddress")}</Button>
        </SheetClose>
      </SheetContent>
    </Sheet>
  );
}
