import { History } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { Suspense } from "react";
import { z } from "zod";

import { AdminPage } from "@/components/admin/admin-page";
import { StatusBadge } from "@/components/orders/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/input";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { type AuditChange, auditChanges, type AuditAction, isAuditAction } from "@/lib/admin/audit";
import { ORDER_STATUSES } from "@/lib/admin/orders-query";
import {
  AUDIT_ENTITIES,
  auditAdmins,
  type AuditEntity,
  type AuditEntry,
  auditLog,
  auditNames,
} from "@/lib/admin/staff-queries";
import { requireViewer } from "@/lib/auth/viewer";
import type { Json } from "@/lib/database.types";
import { formatDayTime } from "@/lib/dates";
import { formatIQD } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { routes } from "@/lib/routes";

const querySchema = z.object({
  entity: z.enum(AUDIT_ENTITIES).optional().catch(undefined),
  admin: z.uuid().optional().catch(undefined),
  before: z.coerce.number().int().positive().optional().catch(undefined),
});
type AuditQuery = z.output<typeof querySchema>;

function auditHref(query: AuditQuery): string {
  const params = new URLSearchParams();
  if (query.entity) params.set("entity", query.entity);
  if (query.admin) params.set("admin", query.admin);
  if (query.before) params.set("before", String(query.before));
  const search = params.toString();
  return search ? `${routes.adminAudit}?${search}` : routes.adminAudit;
}

/**
 * The admin audit log (spec §7, §8.2): every admin write, newest first, 50
 * at a time, filtered by area and by admin (`?entity=`, `?admin=`,
 * `?before=<id>`).
 */
export default async function AuditPage(props: PageProps<"/admin/audit">) {
  const t = await getTranslations("Admin.audit");
  return (
    <AdminPage title={t("title")}>
      <p className="max-w-3xl text-15 text-body-2">{t("intro")}</p>
      <Suspense
        fallback={
          <SkeletonGroup className="flex flex-col gap-3">
            <Skeleton className="h-16 rounded-card" />
            <Skeleton className="h-96 rounded-card" />
          </SkeletonGroup>
        }
      >
        <Audit {...props} />
      </Suspense>
    </AdminPage>
  );
}

async function Audit({ searchParams }: PageProps<"/admin/audit">) {
  await requireViewer(routes.adminAudit, "admin");
  const t = await getTranslations("Admin.audit");
  const raw = await searchParams;
  const query = querySchema.parse(
    Object.fromEntries(
      Object.entries(raw).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
    ),
  );
  const [{ entries, nextBefore }, admins] = await Promise.all([
    auditLog({ entity: query.entity, adminId: query.admin, before: query.before }),
    auditAdmins(),
  ]);
  const names = await auditNames(entries);
  const filtered = Boolean(query.entity || query.admin);

  return (
    <>
      <form
        action={routes.adminAudit}
        className="flex flex-wrap items-end gap-3 rounded-card border border-border bg-surface p-4"
      >
        <Field label={t("filterEntity")} variant="compact" className="w-56">
          {(control) => (
            <Select {...control} name="entity" variant="compact" defaultValue={query.entity ?? ""}>
              <option value="">{t("allEntities")}</option>
              {AUDIT_ENTITIES.map((entity) => (
                <option key={entity} value={entity}>
                  {t(`entities.${entity}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("filterAdmin")} variant="compact" className="w-56">
          {(control) => (
            <Select {...control} name="admin" variant="compact" defaultValue={query.admin ?? ""}>
              <option value="">{t("allAdmins")}</option>
              {admins.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.fullName ?? formatPhone(a.phone)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Button type="submit" size="sm">
          {t("apply")}
        </Button>
      </form>

      {entries.length === 0 ? (
        <Card className="py-6">
          <EmptyState
            icon={History}
            title={filtered ? t("emptyFilteredTitle") : t("emptyTitle")}
            description={filtered ? undefined : t("emptyBody")}
            action={
              filtered && (
                <Link
                  href={routes.adminAudit}
                  className="inline-flex min-h-11 items-center font-extrabold text-teal"
                >
                  {t("clearFilters")}
                </Link>
              )
            }
          />
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-card border border-border bg-surface">
          <table className="w-full min-w-3xl text-14">
            <caption className="sr-only">{t("caption")}</caption>
            <thead className="bg-well text-13">
              <tr>
                {(["colWhen", "colAdmin", "colAction", "colTarget", "colDetails"] as const).map(
                  (key) => (
                    <th
                      key={key}
                      scope="col"
                      className="px-3 py-2.5 text-start font-bold text-muted"
                    >
                      {t(key)}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <EntryRow key={entry.id} entry={entry} names={names} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(query.before || nextBefore) && (
        <nav className="flex flex-wrap gap-3" aria-label={t("caption")}>
          {query.before && (
            <Link
              href={auditHref({ ...query, before: undefined })}
              className="inline-flex min-h-11 items-center rounded-button border border-border bg-surface px-4 font-bold text-navy"
            >
              {t("newest")}
            </Link>
          )}
          {nextBefore && (
            <Link
              href={auditHref({ ...query, before: nextBefore })}
              className="inline-flex min-h-11 items-center rounded-button border border-border bg-surface px-4 font-bold text-navy"
            >
              {t("older")}
            </Link>
          )}
        </nav>
      )}
    </>
  );
}

type Names = Awaited<ReturnType<typeof auditNames>>;

async function EntryRow({ entry, names }: { entry: AuditEntry; names: Names }) {
  const t = await getTranslations("Admin.audit");
  const action = isAuditAction(entry.action) ? entry.action : null;
  const changes = auditChanges(entry.diff);
  return (
    <tr className="border-t border-divider align-top" data-testid={`audit-${entry.id}`}>
      <td className="px-3 py-3 whitespace-nowrap">{formatDayTime(entry.createdAt)}</td>
      <td className="px-3 py-3">{entry.admin.fullName ?? formatPhone(entry.admin.phone)}</td>
      <th scope="row" className="px-3 py-3 text-start font-extrabold">
        {action ? t(`actions.${action}`) : <bdi dir="ltr">{entry.action}</bdi>}
      </th>
      <td className="px-3 py-3">
        <Target entry={entry} names={names} />
      </td>
      <td className="px-3 py-3">
        <ul className="flex flex-col gap-1">
          {changes.map((change, i) => (
            <li key={i} className="flex flex-wrap items-center gap-1.5">
              <ChangeLine change={change} action={action} names={names} />
            </li>
          ))}
        </ul>
      </td>
    </tr>
  );
}

async function Target({ entry, names }: { entry: AuditEntry; names: Names }) {
  const t = await getTranslations("Admin.audit");
  const tTanks = await getTranslations("Tanks");
  switch (entry.entity as AuditEntity) {
    case "orders": {
      const number = names.orders.get(entry.entityId);
      return (
        <Link
          href={routes.adminOrder(entry.entityId)}
          className="inline-flex min-h-11 items-center font-extrabold text-teal underline-offset-2 hover:underline"
        >
          <span dir="ltr">
            {number ? t("orderNumber", { number }) : entry.entityId.slice(0, 8)}
          </span>
        </Link>
      );
    }
    case "crews":
      return <>{names.crews.get(entry.entityId) ?? entry.entityId.slice(0, 8)}</>;
    case "price_list": {
      const [type, size] = entry.entityId.split("/");
      if (
        (type === "roof" || type === "ground") &&
        (size === "s" || size === "m" || size === "l")
      ) {
        return (
          <>
            {tTanks(`types.${type}`)} · {tTanks(`sizes.${size}`)}
          </>
        );
      }
      return <bdi dir="ltr">{entry.entityId}</bdi>;
    }
    case "profiles": {
      const diff = entry.diff;
      const phone =
        typeof diff === "object" && diff !== null && !Array.isArray(diff) ? diff.phone : null;
      return typeof phone === "string" ? (
        <span dir="ltr">{formatPhone(phone)}</span>
      ) : (
        <bdi dir="ltr">{entry.entityId.slice(0, 8)}</bdi>
      );
    }
    case "settings":
      return <>{t("entities.settings")}</>;
    default:
      return <bdi dir="ltr">{entry.entityId}</bdi>;
  }
}

/** Fields with a label (Admin.audit.fields), settings columns included. */
const KNOWN_FIELDS = [
  "name",
  "active",
  "phone",
  "role",
  "full_name",
  "reason",
  "override",
  "capacity",
  "weekdays",
  "area",
  "start_time",
  "end_time",
  "sms_enabled",
  "company_phone",
  "working_hours_start",
  "working_hours_end",
  "working_days",
  "cleaning_interval_months",
  "booking_window_days",
  "cancel_cutoff_hours",
  "max_tanks_per_order",
  "terms_md",
  "privacy_md",
  "sterilant_text",
  "certificate_text",
  "support_response_text",
  "min_app_version",
  "maintenance_mode",
] as const;

/** Long values (Terms, Privacy) are cut in the table. */
const MAX_SHOWN = 120;
const shorten = (text: string) => (text.length > MAX_SHOWN ? `${text.slice(0, MAX_SHOWN)}…` : text);

async function FieldLabel({ field }: { field: string }) {
  const t = await getTranslations("Admin.audit");
  const known = (KNOWN_FIELDS as readonly string[]).includes(field)
    ? (field as (typeof KNOWN_FIELDS)[number])
    : null;
  return (
    <span className="font-bold text-muted">
      {known ? t(`fields.${known}`) : <bdi dir="ltr">{field}</bdi>}:
    </span>
  );
}

async function ChangeLine({
  change,
  action,
  names,
}: {
  change: AuditChange;
  action: AuditAction | null;
  names: Names;
}) {
  const ctx = { action, field: change.field, names };
  if (change.kind === "value") {
    return (
      <>
        <FieldLabel field={change.field} />
        <Value value={change.value} {...ctx} />
      </>
    );
  }
  return (
    <>
      {change.field && <FieldLabel field={change.field} />}
      <Value value={change.from} {...ctx} />
      <span aria-hidden className="text-muted">
        ←
      </span>
      <Value value={change.to} {...ctx} />
    </>
  );
}

async function Value({
  value,
  action,
  field,
  names,
}: {
  value: Json;
  action: AuditAction | null;
  field: string | null;
  names: Names;
}): Promise<ReactNode> {
  const t = await getTranslations("Admin.audit");
  if (field === null && action === "order.transition" && typeof value === "string") {
    if ((ORDER_STATUSES as readonly string[]).includes(value)) {
      return <StatusBadge status={value as (typeof ORDER_STATUSES)[number]} />;
    }
  }
  if (field === null && action === "order.assign_crew") {
    return <>{typeof value === "string" ? (names.crews.get(value) ?? value) : t("noCrew")}</>;
  }
  if (field === null && action === "price.update" && typeof value === "number") {
    return <span dir="ltr">{formatIQD(value)}</span>;
  }
  if (value === null) return <>{t("none")}</>;
  if (typeof value === "boolean") return <>{value ? t("yes") : t("no")}</>;
  if (field === "role" && (value === "customer" || value === "crew" || value === "admin")) {
    return <>{t(`roles.${value}`)}</>;
  }
  if (
    typeof value === "string" &&
    (field === "phone" || action === "crew.phone") &&
    value.startsWith("+")
  ) {
    return <span dir="ltr">{formatPhone(value)}</span>;
  }
  if (field === "area") return <>{t("shape")}</>;
  if (typeof value === "object") {
    return (
      <bdi dir="ltr" className="font-mono text-12 break-all">
        {shorten(JSON.stringify(value))}
      </bdi>
    );
  }
  return <bdi>{shorten(String(value))}</bdi>;
}
