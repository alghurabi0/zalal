"use client";

import { Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Fragment, useState } from "react";

import { useAdminEdit } from "@/components/admin/use-admin-edit";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import type { ExpenseCategory } from "@/lib/admin/finance-queries";
import { cn } from "@/lib/cn";
import {
  EXPENSE_CATEGORY_KINDS,
  type ExpenseCategoryKind,
  FINANCE_NAME_MAX,
} from "@/lib/schemas/finance";

import { deleteExpenseCategory, saveExpenseCategory } from "../actions";

const nameOk = (name: string) => {
  const trimmed = name.trim();
  return trimmed.length >= 2 && trimmed.length <= FINANCE_NAME_MAX;
};

/** A17's expense categories: kind and state, edited in place; delete while unused. */
export function CategoryList({ categories }: { categories: ExpenseCategory[] }) {
  const t = useTranslations("Admin.finance");
  const [editing, setEditing] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const columns = ["name", "kind", "state"] as const;

  return (
    <div className="flex flex-col gap-3">
      <p role="status" className={cn("text-14 font-bold text-ok-fg", !notice && "sr-only")}>
        {notice}
      </p>
      <div className="overflow-x-auto rounded-card border border-border bg-surface">
        <table className="w-full min-w-2xl text-14">
          <caption className="sr-only">{t("settings.categoriesTitle")}</caption>
          <thead className="bg-well text-13 text-muted">
            <tr>
              {columns.map((column) => (
                <th key={column} scope="col" className="px-3 py-2.5 text-start font-bold">
                  {t(`settings.categoryColumns.${column}`)}
                </th>
              ))}
              <th scope="col" className="px-3 py-2.5">
                <span className="sr-only">{t("edit")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {categories.map((category) => (
              <Fragment key={category.id}>
                <tr className={cn("border-t border-divider", !category.active && "text-muted")}>
                  <th scope="row" className="px-3 py-3 text-start font-extrabold">
                    {category.name}
                  </th>
                  <td className="px-3 py-3">{t(`categoryKinds.${category.kind}`)}</td>
                  <td className="px-3 py-3">
                    <span
                      className={cn(
                        "rounded-10 px-2 py-0.5 text-12 font-extrabold",
                        category.active ? "bg-ok-bg text-ok-fg" : "bg-well text-muted",
                      )}
                    >
                      {category.active ? t("active") : t("inactive")}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-end">
                    <Button
                      size="sm"
                      variant={editing === category.id ? "primary" : "secondary"}
                      aria-expanded={editing === category.id}
                      aria-label={t("editLabel", { name: category.name })}
                      onClick={() => {
                        setNotice(null);
                        setEditing(editing === category.id ? null : category.id);
                      }}
                    >
                      {t("edit")}
                    </Button>
                  </td>
                </tr>
                {editing === category.id && (
                  <tr className="bg-bg">
                    <td colSpan={4} className="px-3 py-4">
                      <CategoryForm
                        category={category}
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
      {adding ? (
        <div className="rounded-card border border-border bg-surface p-4">
          <CategoryForm
            category={null}
            onDone={(message) => {
              setAdding(false);
              setNotice(message);
            }}
            onCancel={() => setAdding(false)}
          />
        </div>
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
          {t("settings.addCategory")}
        </Button>
      )}
    </div>
  );
}

function CategoryForm({
  category,
  onDone,
  onCancel,
}: {
  category: ExpenseCategory | null;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("Admin.finance");
  const tErrors = useTranslations("Admin.editErrors");
  const edit = useAdminEdit();
  const remove = useAdminEdit();
  const [name, setName] = useState(category?.name ?? "");
  const [kind, setKind] = useState<ExpenseCategoryKind>(category?.kind ?? "general");
  const [active, setActive] = useState(category?.active ?? true);
  const [tried, setTried] = useState(false);
  const title = category ? t("editLabel", { name: category.name }) : t("settings.addCategory");
  const error = edit.error ?? remove.error;

  return (
    <form
      aria-label={title}
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setTried(true);
        if (!nameOk(name)) return;
        edit.run(
          () => saveExpenseCategory({ id: category?.id ?? null, name, kind, active }),
          () => onDone(category ? t("saved") : t("settings.categoryAdded")),
        );
      }}
    >
      <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
        <Field
          label={t("settings.categoryName")}
          variant="compact"
          className="w-64"
          error={tried && !nameOk(name) ? t("nameRange", { max: FINANCE_NAME_MAX }) : undefined}
        >
          {(control) => (
            <Input
              {...control}
              variant="compact"
              maxLength={FINANCE_NAME_MAX + 10}
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
        <Field
          label={t("settings.categoryKind")}
          variant="compact"
          className="w-56"
          hint={t(`categoryKindHints.${kind}`)}
        >
          {(control) => (
            <Select
              {...control}
              variant="compact"
              value={kind}
              onChange={(event) => setKind(event.target.value as ExpenseCategoryKind)}
            >
              {EXPENSE_CATEGORY_KINDS.map((value) => (
                <option key={value} value={value}>
                  {t(`categoryKinds.${value}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {category && (
          <label className="flex min-h-11 items-center gap-2.5 self-center text-14 font-bold">
            <input
              type="checkbox"
              className="size-5 accent-navy"
              checked={active}
              onChange={(event) => setActive(event.target.checked)}
            />
            {t("settings.categoryActive")}
          </label>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" loading={edit.pending}>
          {category ? t("save") : t("settings.addCategory")}
        </Button>
        <Button size="sm" variant="secondary" onClick={onCancel}>
          {t("cancel")}
        </Button>
        {category && (
          <Button
            size="sm"
            variant="secondary"
            loading={remove.pending}
            onClick={() =>
              remove.run(
                () => deleteExpenseCategory(category.id),
                () => onDone(t("settings.categoryDeleted")),
              )
            }
          >
            <Trash2 aria-hidden className="size-4" />
            {t("settings.deleteCategory")}
          </Button>
        )}
        <p role="status" className="text-13 font-bold text-danger">
          {error && tErrors(error)}
        </p>
      </div>
    </form>
  );
}
