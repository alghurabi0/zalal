"use client";

import { ScreenError } from "@/components/layout/screen-error";

export default function CrewError(props: { error: unknown; retry: () => void }) {
  return <ScreenError {...props} />;
}
