"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { useAdminEdit } from "@/components/admin/use-admin-edit";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { TICKET_NOTE_MAX, TICKET_STATUSES, type TicketStatus } from "@/lib/tickets/format";

import { addTicketNote, setTicketStatus } from "./actions";

/**
 * A5's actions: the status (any of open, in progress, closed; reopening is
 * allowed) and a new internal note. Both are audited by the database.
 */
export function TicketActions({ ticketId, status }: { ticketId: string; status: TicketStatus }) {
  const t = useTranslations("Admin.tickets");
  const tErrors = useTranslations("Admin.editErrors");
  const statusEdit = useAdminEdit();
  const noteEdit = useAdminEdit();
  const [note, setNote] = useState("");

  return (
    <div className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-16 font-extrabold">{t("drawer.statusLabel")}</legend>
        <div className="flex flex-wrap gap-2">
          {TICKET_STATUSES.map((option) => {
            const current = option === status;
            return (
              <Button
                key={option}
                type="button"
                size="sm"
                variant={current ? "primary" : "secondary"}
                aria-pressed={current}
                disabled={statusEdit.pending}
                onClick={() => {
                  if (current) return;
                  statusEdit.run(
                    () => setTicketStatus({ ticketId, status: option }),
                    () => undefined,
                  );
                }}
                className={cn("flex-1", current && "cursor-default")}
              >
                {t(`statuses.${option}`)}
              </Button>
            );
          })}
        </div>
        {statusEdit.error && (
          <p role="alert" className="text-14 font-bold text-danger">
            {tErrors(statusEdit.error)}
          </p>
        )}
      </fieldset>

      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const text = note.trim();
          if (!text) return;
          noteEdit.run(
            () => addTicketNote({ ticketId, note: text }),
            () => setNote(""),
          );
        }}
      >
        <Field
          label={t("drawer.noteLabel")}
          error={noteEdit.error ? tErrors(noteEdit.error) : undefined}
        >
          {(control) => (
            <Textarea
              {...control}
              name="note"
              rows={2}
              maxLength={TICKET_NOTE_MAX}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          )}
        </Field>
        <Button
          type="submit"
          size="sm"
          variant="secondary"
          className="self-end"
          loading={noteEdit.pending}
          disabled={note.trim().length === 0}
        >
          {t("drawer.addNote")}
        </Button>
      </form>
    </div>
  );
}
