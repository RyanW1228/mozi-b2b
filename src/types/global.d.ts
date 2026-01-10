// src/types/global.d.ts
import type { IntentRow } from "@/lib/types/intentRow";

declare global {
  // eslint-disable-next-line no-var
  var __moziIntentStore: Map<string, IntentRow> | undefined;
}

export {};
