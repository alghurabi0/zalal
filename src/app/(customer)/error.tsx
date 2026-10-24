"use client";

// Error state for every customer screen (spec §5): reported, with "اعد المحاولة".

import { ScreenError } from "@/components/layout/screen-error";

export default function CustomerError(props: { error: unknown; retry: () => void }) {
  return <ScreenError {...props} />;
}
