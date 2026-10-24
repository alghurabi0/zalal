import type { LucideIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { LogoutButton } from "@/components/auth/logout-button";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { type Role, requireViewer } from "@/lib/auth/viewer";

import { Screen } from "./screen";

/**
 * The crew and admin surfaces until Phase 3 builds them: a short note and
 * logout, for that role only (spec §2).
 */
export async function SurfacePlaceholder(props: {
  role: Exclude<Role, "customer">;
  path: string;
  icon: LucideIcon;
  title: string;
  body: string;
}) {
  await requireViewer(props.path, props.role);
  const t = await getTranslations("Profile");
  return (
    <Screen className="justify-center">
      <EmptyState
        icon={props.icon}
        titleAs="h1"
        title={props.title}
        description={props.body}
        action={
          <LogoutButton>
            <Button variant="secondary" size="footer" className="w-full">
              {t("logout")}
            </Button>
          </LogoutButton>
        }
      />
    </Screen>
  );
}
