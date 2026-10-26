import { SearchX } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { BackButton } from "@/components/ui/back-button";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { routes } from "@/lib/routes";

/** An order that doesn't exist or isn't the viewer's, on Tracking and Job progress. */
export async function OrderMissing() {
  const t = await getTranslations("Order");
  return (
    <div className="flex flex-1 flex-col bg-bg">
      <div className="px-5 pt-5 pb-3.5">
        <BackButton href={routes.orders} />
      </div>
      <EmptyState
        icon={SearchX}
        titleAs="h1"
        title={t("notFound")}
        description={t("notFoundBody")}
        action={
          <Button href={routes.orders} size="footer" className="w-full">
            {t("toOrders")}
          </Button>
        }
      />
    </div>
  );
}
