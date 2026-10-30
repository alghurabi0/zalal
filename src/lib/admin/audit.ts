import type { Json } from "@/lib/database.types";

// The audit log screen (spec §8.2): turns a log row's diff into lines the
// page renders. Every admin RPC logs only what changed, in one of two
// shapes (supabase/CLAUDE.md):
// - one value that changed: {"from": …, "to": …} (a price, an order's crew
//   or status, a crew's phone), sometimes with more keys beside it (a
//   transition's override flag, reason and reschedule details);
// - named fields, each {"from": …, "to": …} when it changed, or a plain value
//   for what a new row was created with.

/** The actions the screen has a label for (Admin.audit.actions in ar.json). */
export const AUDIT_ACTIONS = [
  "order.transition",
  "order.assign_crew",
  "price.update",
  "slot.create",
  "slot.update",
  "blocked_date.add",
  "blocked_date.update",
  "blocked_date.remove",
  "settings.update",
  "service_area.create",
  "service_area.update",
  "crew.create",
  "crew.update",
  "crew.phone",
  "admin.add",
  "admin.remove",
  "ticket.status",
  "ticket.note",
  "article.create",
  "article.update",
  "article.delete",
  "category.create",
  "category.update",
  "category.delete",
  "category.reorder",
  "subscription.activate",
  "subscription.paid",
  "subscription.adjust",
  "subscription.decline",
  "subscription.cancel",
  "subscription.note",
  "order.subscription",
  "finance.settings",
  "finance_account.create",
  "finance_account.update",
  "expense_category.create",
  "expense_category.update",
  "expense_category.delete",
  "expense.create",
  "expense.update",
  "expense.void",
  "transfer.create",
  "transfer.update",
  "transfer.void",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export function isAuditAction(action: string): action is AuditAction {
  return (AUDIT_ACTIONS as readonly string[]).includes(action);
}

/** One line of a diff. `field` is null for the row's single changed value. */
export type AuditChange =
  | { kind: "change"; field: string | null; from: Json; to: Json }
  | { kind: "value"; field: string; value: Json };

function isChange(value: Json): value is { from: Json; to: Json } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "from" in value &&
    "to" in value
  );
}

export function auditChanges(diff: Json): AuditChange[] {
  if (typeof diff !== "object" || diff === null || Array.isArray(diff)) return [];
  const changes: AuditChange[] = [];
  if (isChange(diff)) {
    changes.push({ kind: "change", field: null, from: diff.from ?? null, to: diff.to ?? null });
  }
  for (const [field, value] of Object.entries(diff)) {
    if (value === undefined) continue;
    if (isChange(diff) && (field === "from" || field === "to")) continue;
    if (isChange(value)) {
      changes.push({ kind: "change", field, from: value.from ?? null, to: value.to ?? null });
    } else {
      changes.push({ kind: "value", field, value });
    }
  }
  return changes;
}
