import type { ComponentProps } from "react";
import type Link from "next/link";

import { BackButton } from "@/components/ui/back-button";
import { StepProgress } from "@/components/ui/step-progress";

type BookingHeaderProps = {
  title: string;
  /** "الخطوة 1 من 3 · تفاصيل الخزان" */
  step: string;
  current: 1 | 2 | 3;
  backHref: ComponentProps<typeof Link>["href"];
};

/** The top of each booking step: back, title, step line and the three bars. */
export function BookingHeader({ title, step, current, backHref }: BookingHeaderProps) {
  return (
    <header className="flex flex-col gap-3 px-5 pt-4.5 pb-2">
      <div className="flex items-center gap-3">
        <BackButton href={backHref} />
        <div className="flex flex-1 flex-col">
          <h1 className="text-20 leading-snug font-black">{title}</h1>
          <span className="text-13 text-muted">{step}</span>
        </div>
      </div>
      <StepProgress steps={3} current={current} />
    </header>
  );
}
