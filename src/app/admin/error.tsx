"use client";

import { ScreenError } from "@/components/layout/screen-error";

export default function AdminError(props: { error: unknown; retry: () => void }) {
  return <ScreenError {...props} />;
}
