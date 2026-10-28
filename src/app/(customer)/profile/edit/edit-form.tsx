"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

import { type EditNameState, saveProfileName } from "./actions";

const errorKeys = { too_short: "tooShort", too_long: "tooLong", failed: "failed" } as const;

/** N10's name field, with N1's rules and words. */
export function EditNameForm({ name, children }: { name: string; children: React.ReactNode }) {
  const t = useTranslations("EditProfile");
  const tName = useTranslations("Name");
  const [state, action, pending] = useActionState<EditNameState, FormData>(saveProfileName, {
    error: null,
  });

  return (
    <form action={action} className="flex flex-1 flex-col gap-6">
      <Field
        label={tName("label")}
        error={state.error ? tName(`errors.${errorKeys[state.error]}`) : undefined}
      >
        {(control) => (
          <Input
            {...control}
            name="fullName"
            autoComplete="name"
            required
            minLength={2}
            maxLength={40}
            defaultValue={state.value ?? name}
            placeholder={tName("placeholder")}
          />
        )}
      </Field>
      {children}
      <div className="flex-1" />
      <Button type="submit" loading={pending}>
        {t("save")}
      </Button>
    </form>
  );
}
