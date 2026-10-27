import { badgeToneClasses } from "@/components/orders/status-badge";
import { cn } from "@/lib/cn";
import { type TicketStatus, ticketStatusTone } from "@/lib/tickets/format";

/** A ticket's status pill (N11, A5): مفتوح / قيد المعالجة / مغلق. */
export function TicketStatusBadge({
  status,
  label,
  className,
}: {
  status: TicketStatus;
  label: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-10 px-2.5 py-0.5 text-12 font-extrabold whitespace-nowrap",
        badgeToneClasses[ticketStatusTone(status)],
        className,
      )}
    >
      {label}
    </span>
  );
}
