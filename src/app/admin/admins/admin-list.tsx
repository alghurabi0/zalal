"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { useAdminEdit } from "@/components/admin/use-admin-edit";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { AdminAccount } from "@/lib/admin/staff-queries";
import { cn } from "@/lib/cn";
import { formatPhone, normalizeIraqiMobile } from "@/lib/phone";
import { fullNameSchema } from "@/lib/schemas/profile";

import { addAdmin, removeAdmin } from "./actions";

const nameOk = (name: string) => fullNameSchema.safeParse(name).success;

/** The A14 list: every admin, with remove on everyone but the viewer. */
export function AdminList({ admins, viewerId }: { admins: AdminAccount[]; viewerId: string }) {
  const t = useTranslations("Admin.admins");
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-3">
      <p role="status" className={cn("text-14 font-bold text-ok-fg", !notice && "sr-only")}>
        {notice}
      </p>
      <div className="overflow-x-auto rounded-card border border-border bg-surface">
        <table className="w-full min-w-xl text-14">
          <caption className="sr-only">{t("caption")}</caption>
          <thead className="bg-well text-13">
            <tr>
              {(["colName", "colPhone"] as const).map((key) => (
                <th key={key} scope="col" className="px-3 py-2.5 text-start font-bold text-muted">
                  {t(key)}
                </th>
              ))}
              <th scope="col" className="px-3 py-2.5">
                <span className="sr-only">{t("remove")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {admins.map((account) => (
              <AdminRow
                key={account.id}
                account={account}
                isViewer={account.id === viewerId}
                onRemoved={() => setNotice(t("removed"))}
              />
            ))}
          </tbody>
        </table>
      </div>

      {adding ? (
        <AddAdmin
          onDone={(message) => {
            setAdding(false);
            setNotice(message);
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <Button
          size="sm"
          variant="secondary"
          className="self-start"
          onClick={() => {
            setNotice(null);
            setAdding(true);
          }}
        >
          <Plus aria-hidden className="size-4" />
          {t("add")}
        </Button>
      )}
    </div>
  );
}

function AdminRow({
  account,
  isViewer,
  onRemoved,
}: {
  account: AdminAccount;
  isViewer: boolean;
  onRemoved: () => void;
}) {
  const t = useTranslations("Admin.admins");
  const tErrors = useTranslations("Admin.editErrors");
  const [confirming, setConfirming] = useState(false);
  const { error, pending, run } = useAdminEdit();
  const name = account.fullName ?? t("noName");

  return (
    <tr className="border-t border-divider align-top">
      <th scope="row" className="px-3 py-3 text-start font-extrabold">
        <span className="flex flex-wrap items-center gap-2">
          {name}
          {isViewer && (
            <span className="rounded-10 bg-selected px-2 py-0.5 text-12 font-extrabold text-teal">
              {t("you")}
            </span>
          )}
        </span>
      </th>
      <td className="px-3 py-3">
        <span dir="ltr">{formatPhone(account.phone)}</span>
      </td>
      <td className="px-3 py-2 text-end">
        {!isViewer &&
          (confirming ? (
            <div className="flex flex-col items-end gap-2">
              <p className="text-13 font-bold text-warn-fg">{t("confirmRemove", { name })}</p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  loading={pending}
                  onClick={() =>
                    run(
                      () => removeAdmin({ userId: account.id }),
                      () => onRemoved(),
                    )
                  }
                >
                  {t("confirm")}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setConfirming(false)}>
                  {t("cancel")}
                </Button>
              </div>
              <p role="status" className="text-13 font-bold text-danger">
                {error && tErrors(error)}
              </p>
            </div>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              aria-label={t("removeLabel", { name })}
              onClick={() => setConfirming(true)}
            >
              {t("remove")}
            </Button>
          ))}
      </td>
    </tr>
  );
}

function AddAdmin({
  onDone,
  onCancel,
}: {
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("Admin.admins");
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
          run(
            () => addAdmin({ name, phone }),
            (result) => {
              const message = result.added ? t("added") : t("alreadyAdmin");
              onDone(
                result.openOrders > 0
                  ? `${message} ${t("openOrders", { count: result.openOrders })}`
                  : message,
              );
            },
          );
        }}
      >
        <div className="flex flex-wrap items-start gap-4">
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
          <Field
            label={t("name")}
            variant="compact"
            className="w-64"
            hint={t("nameHint")}
            error={name !== "" && !nameOk(name) ? t("nameRange") : undefined}
          >
            {(control) => (
              <Input
                {...control}
                variant="compact"
                required
                maxLength={50}
                value={name}
                onChange={(event) => setName(event.target.value)}
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
