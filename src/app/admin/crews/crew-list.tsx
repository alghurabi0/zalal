"use client";

import { Plus, Users } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Fragment, useState } from "react";

import { useAdminEdit } from "@/components/admin/use-admin-edit";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { adminOrdersHref } from "@/lib/admin/orders-query";
import type { AdminCrew } from "@/lib/admin/staff-queries";
import { cn } from "@/lib/cn";
import { formatPhone, normalizeIraqiMobile } from "@/lib/phone";
import { CREW_NAME_MAX, crewNameSchema } from "@/lib/schemas/admin-staff";

import { createCrew, setCrewPhone, updateCrew } from "./actions";

const nameOk = (name: string) => crewNameSchema.safeParse(name).success;

/** The A10 table: each crew's name, phone, open orders and state, edited in place. */
export function CrewList({ crews }: { crews: AdminCrew[] }) {
  const t = useTranslations("Admin.crews");
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const addButton = (
    <Button
      size="sm"
      variant={crews.length === 0 ? "primary" : "secondary"}
      className="self-start"
      onClick={() => {
        setNotice(null);
        setAdding(true);
      }}
    >
      <Plus aria-hidden className="size-4" />
      {t("add")}
    </Button>
  );

  return (
    <div className="flex flex-col gap-3">
      <p role="status" className={cn("text-14 font-bold text-ok-fg", !notice && "sr-only")}>
        {notice}
      </p>
      {crews.length === 0 ? (
        <Card className="py-6">
          <EmptyState
            icon={Users}
            title={t("emptyTitle")}
            description={t("emptyBody")}
            action={!adding && addButton}
          />
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-card border border-border bg-surface">
          <table className="w-full min-w-2xl text-14">
            <caption className="sr-only">{t("caption")}</caption>
            <thead className="bg-well text-13">
              <tr>
                {(["colName", "colPhone", "colOpen", "colState"] as const).map((key) => (
                  <th key={key} scope="col" className="px-3 py-2.5 text-start font-bold text-muted">
                    {t(key)}
                  </th>
                ))}
                <th scope="col" className="px-3 py-2.5">
                  <span className="sr-only">{t("edit")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {crews.map((crew) => (
                <Fragment key={crew.id}>
                  <tr
                    className={cn("border-t border-divider", !crew.active && "text-muted")}
                    data-testid={`crew-${crew.id}`}
                  >
                    <th scope="row" className="px-3 py-3 text-start font-extrabold">
                      {crew.name}
                    </th>
                    <td className="px-3 py-3">
                      <span dir="ltr">{formatPhone(crew.phone)}</span>
                    </td>
                    <td className="px-3 py-3">
                      {crew.openOrders > 0 ? (
                        <Link
                          href={adminOrdersHref({ crew: crew.id })}
                          className="inline-flex min-h-11 min-w-11 items-center font-extrabold text-teal underline-offset-2 hover:underline"
                        >
                          {crew.openOrders}
                          <span className="sr-only">
                            {" "}
                            {t("openOrdersLink", { name: crew.name })}
                          </span>
                        </Link>
                      ) : (
                        0
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={cn(
                          "rounded-10 px-2 py-0.5 text-12 font-extrabold",
                          crew.active ? "bg-ok-bg text-ok-fg" : "bg-well text-muted",
                        )}
                      >
                        {crew.active ? t("active") : t("inactive")}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-end">
                      <Button
                        size="sm"
                        variant={editing === crew.id ? "primary" : "secondary"}
                        aria-expanded={editing === crew.id}
                        aria-label={t("editLabel", { name: crew.name })}
                        onClick={() => {
                          setNotice(null);
                          setEditing(editing === crew.id ? null : crew.id);
                        }}
                      >
                        {t("edit")}
                      </Button>
                    </td>
                  </tr>
                  {editing === crew.id && (
                    <tr className="bg-bg">
                      <td colSpan={5} className="px-3 py-4">
                        <EditCrew
                          crew={crew}
                          onDone={(message) => {
                            setEditing(null);
                            setNotice(message);
                          }}
                          onCancel={() => setEditing(null)}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adding ? (
        <AddCrew
          onDone={() => {
            setAdding(false);
            setNotice(t("created"));
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        crews.length > 0 && addButton
      )}
    </div>
  );
}

function EditCrew({
  crew,
  onDone,
  onCancel,
}: {
  crew: AdminCrew;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("Admin.crews");
  const tErrors = useTranslations("Admin.editErrors");
  const [name, setName] = useState(crew.name);
  const [active, setActive] = useState(crew.active);
  const [phone, setPhone] = useState("");
  const edit = useAdminEdit();
  const phoneEdit = useAdminEdit();
  const switchingOff = crew.active && !active;
  const newPhone = normalizeIraqiMobile(phone);

  return (
    <div className="flex flex-col gap-5">
      <form
        aria-label={t("editLabel", { name: crew.name })}
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!nameOk(name)) return;
          edit.run(
            () => updateCrew({ id: crew.id, name, active }),
            (result) =>
              onDone(switchingOff ? t("offDone", { count: result.openOrders }) : t("saved")),
          );
        }}
      >
        <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
          <Field
            label={t("name")}
            variant="compact"
            className="w-64"
            error={nameOk(name) ? undefined : t("nameRange", { max: CREW_NAME_MAX })}
          >
            {(control) => (
              <Input
                {...control}
                variant="compact"
                maxLength={CREW_NAME_MAX + 10}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            )}
          </Field>
          <label className="flex min-h-11 items-center gap-2.5 self-end text-14 font-bold">
            <input
              type="checkbox"
              className="size-5 accent-navy"
              checked={active}
              onChange={(event) => setActive(event.target.checked)}
            />
            {t("activeLabel")}
          </label>
        </div>
        {switchingOff && crew.openOrders > 0 && (
          <p className="rounded-chip bg-warn-bg px-3 py-2 text-13 font-bold text-warn-fg">
            {t("offWarning", { count: crew.openOrders })}{" "}
            <Link
              href={adminOrdersHref({ crew: crew.id })}
              className="underline underline-offset-2"
            >
              {t("openOrdersLink", { name: crew.name })}
            </Link>
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" loading={edit.pending} disabled={!nameOk(name)}>
            {t("save")}
          </Button>
          <Button size="sm" variant="secondary" onClick={onCancel}>
            {t("cancel")}
          </Button>
          <p role="status" className="text-13 font-bold text-danger">
            {edit.error && tErrors(edit.error)}
          </p>
        </div>
      </form>

      <form
        aria-label={t("changePhone")}
        className="flex flex-col gap-3 border-t border-divider pt-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!newPhone) return;
          phoneEdit.run(
            () => setCrewPhone({ id: crew.id, phone }),
            () => onDone(t("phoneSaved")),
          );
        }}
      >
        <h3 className="text-15 font-extrabold">{t("changePhone")}</h3>
        <p className="max-w-2xl text-13 text-body-2">{t("changePhoneIntro")}</p>
        <div className="flex flex-wrap items-end gap-3">
          <Field
            label={t("newPhone")}
            variant="compact"
            className="w-64"
            hint={t("phoneHint")}
            error={phone !== "" && !newPhone ? t("phoneInvalid") : undefined}
          >
            {(control) => (
              <Input
                {...control}
                type="tel"
                inputMode="tel"
                autoComplete="off"
                dir="ltr"
                variant="compact"
                className="text-start"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
            )}
          </Field>
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            loading={phoneEdit.pending}
            disabled={!newPhone}
          >
            {t("savePhone")}
          </Button>
        </div>
        <p role="status" className="text-13 font-bold text-danger">
          {phoneEdit.error && tErrors(phoneEdit.error)}
        </p>
      </form>
    </div>
  );
}

function AddCrew({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const t = useTranslations("Admin.crews");
  const tErrors = useTranslations("Admin.editErrors");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const { error, pending, run } = useAdminEdit();
  const e164 = normalizeIraqiMobile(phone);
  const valid = nameOk(name) && e164 !== null;

  return (
    <Card className="flex flex-col gap-4 p-4">
      <h3 className="text-16 font-extrabold">{t("addTitle")}</h3>
      <form
        aria-label={t("addTitle")}
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid) return;
          run(() => createCrew({ name, phone }), onDone);
        }}
      >
        <div className="flex flex-wrap items-start gap-4">
          <Field
            label={t("name")}
            variant="compact"
            className="w-64"
            error={
              name !== "" && !nameOk(name) ? t("nameRange", { max: CREW_NAME_MAX }) : undefined
            }
          >
            {(control) => (
              <Input
                {...control}
                variant="compact"
                required
                placeholder={t("namePlaceholder")}
                maxLength={CREW_NAME_MAX + 10}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            )}
          </Field>
          <Field
            label={t("phone")}
            variant="compact"
            className="w-64"
            hint={t("phoneHint")}
            error={phone !== "" && !e164 ? t("phoneInvalid") : undefined}
          >
            {(control) => (
              <Input
                {...control}
                type="tel"
                inputMode="tel"
                autoComplete="off"
                dir="ltr"
                variant="compact"
                className="text-start"
                required
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
            )}
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" loading={pending} disabled={!valid}>
            {t("create")}
          </Button>
          <Button size="sm" variant="secondary" onClick={onCancel}>
            {t("cancel")}
          </Button>
          <p role="status" className="text-13 font-bold text-danger">
            {error && tErrors(error)}
          </p>
        </div>
      </form>
    </Card>
  );
}
