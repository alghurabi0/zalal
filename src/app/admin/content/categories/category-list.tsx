"use client";

import { ArrowDown, ArrowUp, FolderTree, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Fragment, useState } from "react";

import { CategoryGlyph } from "@/components/articles/category-icon";
import { useAdminEdit } from "@/components/admin/use-admin-edit";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip, ChipGroup } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import type { AdminCategory } from "@/lib/admin/content-queries";
import { CATEGORY_ICONS, type CategoryIcon } from "@/lib/articles/category-icons";
import { cn } from "@/lib/cn";
import { CATEGORY_NAME_MAX, categoryNameSchema } from "@/lib/schemas/article";

import { deleteCategory, reorderCategories, saveCategory } from "../actions";

/** A11's categories table: order, icon, name and article count, edited in place. */
export function CategoryList({ categories }: { categories: AdminCategory[] }) {
  const t = useTranslations("Admin.content.categoriesPage");
  const tErrors = useTranslations("Admin.editErrors");
  const [editing, setEditing] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const edit = useAdminEdit();

  const move = (index: number, by: -1 | 1) => {
    const ids = categories.map((category) => category.id);
    const [moved] = ids.splice(index, 1);
    if (moved === undefined) return;
    ids.splice(index + by, 0, moved);
    setNotice(null);
    edit.run(
      () => reorderCategories({ ids }),
      () => setNotice(t("reordered")),
    );
  };

  const addButton = (
    <Button
      size="sm"
      variant={categories.length === 0 ? "primary" : "secondary"}
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
      {edit.error && (
        <p role="alert" className="text-14 font-bold text-danger">
          {tErrors(edit.error)}
        </p>
      )}
      {categories.length === 0 ? (
        <Card className="py-6">
          <EmptyState
            icon={FolderTree}
            title={t("emptyTitle")}
            description={t("emptyBody")}
            action={!adding && addButton}
          />
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-card border border-border bg-surface">
          <table className="w-full min-w-xl text-14">
            <caption className="sr-only">{t("caption")}</caption>
            <thead className="bg-well text-13">
              <tr>
                {(["colOrder", "colName", "colArticles"] as const).map((key) => (
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
              {categories.map((category, index) => (
                <Fragment key={category.id}>
                  <tr className="border-t border-divider" data-testid={`category-${category.id}`}>
                    <td className="px-2 py-1">
                      <div className="flex">
                        <IconButton
                          icon={ArrowUp}
                          variant="soft"
                          label={t("moveUp", { name: category.name })}
                          disabled={index === 0 || edit.pending}
                          onClick={() => move(index, -1)}
                        />
                        <IconButton
                          icon={ArrowDown}
                          variant="soft"
                          label={t("moveDown", { name: category.name })}
                          disabled={index === categories.length - 1 || edit.pending}
                          onClick={() => move(index, 1)}
                        />
                      </div>
                    </td>
                    <th scope="row" className="px-3 py-3 text-start font-extrabold">
                      <span className="flex items-center gap-2.5">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-chip bg-selected text-teal">
                          <CategoryGlyph icon={category.icon} className="size-5" />
                        </span>
                        {category.name}
                      </span>
                    </th>
                    <td className="px-3 py-3">{category.articles}</td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant={editing === category.id ? "primary" : "secondary"}
                          aria-expanded={editing === category.id}
                          aria-label={t("editLabel", { name: category.name })}
                          onClick={() => {
                            setNotice(null);
                            setDeleting(null);
                            setEditing(editing === category.id ? null : category.id);
                          }}
                        >
                          {t("edit")}
                        </Button>
                        <Button
                          size="sm"
                          variant="link"
                          className="text-danger"
                          aria-label={t("deleteLabel", { name: category.name })}
                          onClick={() => {
                            setNotice(null);
                            setEditing(null);
                            setDeleting(category.id);
                          }}
                        >
                          {t("delete")}
                        </Button>
                      </div>
                    </td>
                  </tr>
                  {editing === category.id && (
                    <tr className="bg-bg">
                      <td colSpan={4} className="px-3 py-4">
                        <CategoryForm
                          category={category}
                          onDone={() => {
                            setEditing(null);
                            setNotice(t("saved"));
                          }}
                          onCancel={() => setEditing(null)}
                        />
                      </td>
                    </tr>
                  )}
                  {deleting === category.id && (
                    <tr className="bg-bg">
                      <td colSpan={4} className="px-3 py-4">
                        <DeleteCategory
                          category={category}
                          onDone={() => {
                            setDeleting(null);
                            setNotice(t("deleted"));
                          }}
                          onCancel={() => setDeleting(null)}
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
        <Card className="p-4">
          <CategoryForm
            category={null}
            onDone={() => {
              setAdding(false);
              setNotice(t("created"));
            }}
            onCancel={() => setAdding(false)}
          />
        </Card>
      ) : (
        categories.length > 0 && addButton
      )}
    </div>
  );
}

function CategoryForm({
  category,
  onDone,
  onCancel,
}: {
  category: AdminCategory | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("Admin.content.categoriesPage");
  const tIcons = useTranslations("Admin.content.icons");
  const tErrors = useTranslations("Admin.editErrors");
  const [name, setName] = useState(category?.name ?? "");
  const [icon, setIcon] = useState<CategoryIcon>(category?.icon ?? "lightbulb");
  const [tried, setTried] = useState(false);
  const edit = useAdminEdit();
  const nameOk = categoryNameSchema.safeParse(name).success;

  return (
    <form
      aria-label={category ? t("editLabel", { name: category.name }) : t("addTitle")}
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setTried(true);
        if (!nameOk) return;
        edit.run(() => saveCategory({ id: category?.id ?? null, name, icon }), onDone);
      }}
    >
      {!category && <h2 className="text-16 font-extrabold">{t("addTitle")}</h2>}
      <Field
        label={t("name")}
        variant="compact"
        className="max-w-sm"
        error={tried && !nameOk ? t("nameRange", { max: CATEGORY_NAME_MAX }) : undefined}
      >
        {(control) => (
          <Input
            {...control}
            variant="compact"
            value={name}
            maxLength={CATEGORY_NAME_MAX + 5}
            onChange={(event) => setName(event.target.value)}
          />
        )}
      </Field>
      <ChipGroup legend={t("icon")} legendClassName="text-13 font-bold">
        {CATEGORY_ICONS.map((value) => (
          <Chip
            key={value}
            type="radio"
            variant="option"
            name={`icon-${category?.id ?? "new"}`}
            value={value}
            checked={icon === value}
            onChange={() => setIcon(value)}
            className="min-w-20 gap-0.5 py-1.5"
          >
            <CategoryGlyph icon={value} className="size-5" />
            <span className="text-12">{tIcons(value)}</span>
          </Chip>
        ))}
      </ChipGroup>
      {edit.error && (
        <p role="alert" className="text-14 font-bold text-danger">
          {tErrors(edit.error)}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={edit.pending}>
          {category ? t("save") : t("create")}
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}

function DeleteCategory({
  category,
  onDone,
  onCancel,
}: {
  category: AdminCategory;
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("Admin.content.categoriesPage");
  const tErrors = useTranslations("Admin.editErrors");
  const edit = useAdminEdit();
  return (
    <div
      role="group"
      aria-label={t("deleteLabel", { name: category.name })}
      className="flex flex-wrap items-center gap-3"
    >
      <p className="flex-1 text-14 font-bold">{t("deleteConfirm", { name: category.name })}</p>
      {edit.error && (
        <p role="alert" className="basis-full text-14 font-bold text-danger">
          {tErrors(edit.error)}
        </p>
      )}
      <Button
        size="sm"
        className="bg-danger"
        loading={edit.pending}
        onClick={() => edit.run(() => deleteCategory({ id: category.id }), onDone)}
      >
        {t("deleteYes")}
      </Button>
      <Button variant="secondary" size="sm" onClick={onCancel}>
        {t("cancel")}
      </Button>
    </div>
  );
}
