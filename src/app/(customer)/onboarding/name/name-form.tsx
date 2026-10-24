"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

import { saveName, type SaveNameState } from "./actions";

const errorKeys = { too_short: "tooShort", too_long: "tooLong", failed: "failed" } as const;

export function NameForm({ defaultName, next }: { defaultName: string; next: string | null }) {
  const t = useTranslations("Name");
  const [state, action, pending] = useActionState<SaveNameState, FormData>(saveName, {
    error: null,
  });

  return (
    <form action={action} className="flex flex-1 flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-28 font-black">{t("title")}</h1>
        <p className="text-16 text-muted">{t("intro")}</p>
      </div>
      <Field
        label={t("label")}
        error={state.error ? t(`errors.${errorKeys[state.error]}`) : undefined}
      >
        {(control) => (
          <Input
            {...control}
            name="fullName"
            autoComplete="name"
            required
            minLength={2}
            maxLength={40}
            defaultValue={state.value ?? defaultName}
            placeholder={t("placeholder")}
            autoFocus
          />
        )}
      </Field>
      {next && <input type="hidden" name="next" value={next} />}
      <div className="flex-1" />
      <Button type="submit" loading={pending}>
        {t("submit")}
      </Button>
    </form>
  );
}
