import { MapPinOff } from "lucide-react";

import { Screen } from "@/components/layout/screen";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

/** A full-screen message on Location (all labels used, address not found). */
export function AddressMessage(props: {
  title: string;
  description: string;
  cta: string;
  href: string;
}) {
  return (
    <Screen className="justify-center">
      <EmptyState
        icon={MapPinOff}
        titleAs="h1"
        title={props.title}
        description={props.description}
        action={
          <Button href={props.href} size="footer" className="w-full">
            {props.cta}
          </Button>
        }
      />
    </Screen>
  );
}
