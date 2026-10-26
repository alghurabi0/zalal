// Chat's header outside working hours: "نرد بأوقات الدوام 9 ص–9 م" (spec
// §5.16). Settings keep the hours as Postgres times ("09:00:00", Baghdad).

/** A time of day on a 12-hour clock: "9", "9:30"; `pm` picks م or ص. */
export function clockLabel(time: string): { time: string; pm: boolean } {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  const hour = hours % 24;
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return {
    time: minutes ? `${hour12}:${String(minutes).padStart(2, "0")}` : String(hour12),
    pm: hour >= 12,
  };
}
