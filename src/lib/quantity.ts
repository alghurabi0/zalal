// Stock quantities (spec §8.3 A23) as A23, A19 and the low-stock push show
// them. No imports: the service worker bundles this through the notification
// describer.

const grouped = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/** 2.5 → "2.5", 1200 → "1,200", in Western digits as the designs write them. */
export function formatQuantity(value: number): string {
  return grouped.format(value);
}
