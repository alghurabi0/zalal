import type { ComponentProps } from "react";

import { cn } from "@/lib/cn";

/**
 * The phone-width page column (spec decision 1): full width on phones, a
 * centered 430px column on wider screens. Padding and gaps come from
 * `className`, since they differ by screen.
 */
export function Screen({ className, ...props }: ComponentProps<"main">) {
  return (
    <main
      className={cn("mx-auto flex min-h-dvh w-full max-w-phone flex-col", className)}
      {...props}
    />
  );
}
