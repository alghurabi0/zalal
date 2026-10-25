// Money is integer IQD (CLAUDE.md). The designs write amounts with Western
// digits and comma groups ("35,000"); the currency ("د.ع") comes from the
// message that shows the amount (`UI.iqd`), since Arabic stays in ar.json.

const grouped = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** 35000 → "35,000". */
export function formatIQD(amount: number): string {
  if (!Number.isInteger(amount)) throw new Error(`IQD amounts are integers, got ${amount}`);
  return grouped.format(amount);
}
