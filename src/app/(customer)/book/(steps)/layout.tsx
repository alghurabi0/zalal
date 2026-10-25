import { MapPin } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { type ReactNode, Suspense } from "react";

import { Screen } from "@/components/layout/screen";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { chosenAddress, listAddresses } from "@/lib/addresses";
import { requireViewer } from "@/lib/auth/viewer";
import { bookingDays } from "@/lib/booking/availability";
import type { PriceTable } from "@/lib/booking/draft";
import { routes, withNext } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";

import { BookingHeader } from "./booking-header";
import { BookingProvider } from "./booking-provider";
import { BookingSkeleton } from "./booking-skeleton";

/**
 * Booking steps 1–3 (spec §5.9–5.11). This layout stays mounted while the
 * customer moves between the steps, so it loads what they need once: the
 * address (Home's choice, else the default), its saved tanks, the price list,
 * the open days and slots, and the tank limit.
 */
export default function BookingLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<BookingSkeleton />}>
      <BookingData>{children}</BookingData>
    </Suspense>
  );
}

async function BookingData({ children }: { children: ReactNode }) {
  const viewer = await requireViewer(routes.book);
  const supabase = await createClient();
  // These don't depend on the address, so they start right away.
  const shared = Promise.all([
    supabase.from("price_list").select("tank_type, size, price_iqd"),
    supabase.rpc("booking_availability"),
    supabase.from("settings").select("max_tanks_per_order, cancel_cutoff_hours").single(),
  ]);
  const addresses = await listAddresses();
  const address = await chosenAddress(addresses);
  if (!address) return <NoAddress />;

  const [tanks, [prices, availability, settings]] = await Promise.all([
    supabase
      .from("tanks")
      .select("id, type, size, nickname")
      .eq("address_id", address.id)
      .order("created_at"),
    shared,
  ]);
  if (tanks.error) throw new Error(`Tanks read failed: ${tanks.error.message}`);
  if (prices.error) throw new Error(`Prices read failed: ${prices.error.message}`);
  if (availability.error) throw new Error(`Availability failed: ${availability.error.message}`);
  if (settings.error) throw new Error(`Settings read failed: ${settings.error.message}`);

  const priceTable: PriceTable = {
    roof: { s: 0, m: 0, l: 0 },
    ground: { s: 0, m: 0, l: 0 },
  };
  for (const row of prices.data) priceTable[row.tank_type][row.size] = row.price_iqd;

  return (
    <BookingProvider
      data={{
        userId: viewer.id,
        address,
        addresses,
        savedTanks: tanks.data,
        prices: priceTable,
        // Slots inside the cutoff are dropped by the server's clock, never the device's.
        days: bookingDays(availability.data, new Date(), settings.data.cancel_cutoff_hours),
        maxTanks: settings.data.max_tanks_per_order,
      }}
    >
      {children}
    </BookingProvider>
  );
}

async function NoAddress() {
  const t = await getTranslations("Booking");
  return (
    <Screen className="bg-bg">
      <BookingHeader title={t("title")} step={t("step")} current={1} backHref={routes.home} />
      <EmptyState
        icon={MapPin}
        title={t("noAddressTitle")}
        description={t("noAddressBody")}
        action={
          <Button href={withNext(routes.newAddress, routes.book)} size="footer" className="w-full">
            {t("noAddressCta")}
          </Button>
        }
      />
    </Screen>
  );
}
