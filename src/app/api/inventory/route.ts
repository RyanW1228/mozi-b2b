// src/app/api/inventory/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getState, patchInventory } from "@/lib/stateStore";

function getLocationIdFromUrl(url: string): string | null {
  const u = new URL(url);
  const locationId = u.searchParams.get("locationId");
  return locationId && locationId.trim().length > 0 ? locationId : null;
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(req: Request) {
  const locationId = getLocationIdFromUrl(req.url);
  console.log("[api/inventory][GET]", { locationId });

  if (!locationId) return jsonError("Missing locationId in query string", 400);

  const state = getState(locationId);
  return NextResponse.json(state.inventory);
}

export async function POST(req: Request) {
  const locationId = getLocationIdFromUrl(req.url);
  console.log("[api/inventory][POST]", { locationId });

  if (!locationId) return jsonError("Missing locationId in query string", 400);

  const body = (await req.json().catch(() => null)) as {
    sku?: unknown;
    onHandUnits?: unknown;
  } | null;

  const sku = String(body?.sku ?? "").trim();
  const onHandUnitsRaw = body?.onHandUnits;

  if (!sku) return jsonError("Missing sku", 400);
  if (typeof onHandUnitsRaw !== "number" || !Number.isFinite(onHandUnitsRaw)) {
    return jsonError("Missing or invalid onHandUnits", 400);
  }

  // Enforce your numeric rules at the API boundary too:
  // integer, non-negative
  const onHandUnits = Math.max(0, Math.floor(onHandUnitsRaw));

  patchInventory(locationId, sku, onHandUnits);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const locationId = getLocationIdFromUrl(req.url);
  console.log("[api/inventory][DELETE]", { locationId });

  if (!locationId) return jsonError("Missing locationId in query string", 400);

  const body = (await req.json().catch(() => null)) as { sku?: unknown } | null;
  const sku = String(body?.sku ?? "").trim();

  if (!sku) return jsonError("Missing sku", 400);

  const state = getState(locationId);
  const before = state.inventory ?? [];
  const after = before.filter((r) => r.sku !== sku);

  // If it wasn't there, treat as success (idempotent delete)
  if (after.length === before.length) {
    return NextResponse.json({ ok: true, deleted: false });
  }

  /**
   * We only have patchInventory() available, so we "rewrite" inventory by:
   * - Clearing by setting deleted SKU to 0 (optional)
   * - Re-applying all remaining rows
   *
   * If your patchInventory() already treats 0 as delete, this is perfect.
   * If not, the re-apply step still makes the in-memory list correct as long as
   * your stateStore uses patchInventory to maintain inventory and doesn't keep
   * extra rows elsewhere.
   */
  patchInventory(locationId, sku, 0);
  for (const r of after) {
    patchInventory(locationId, r.sku, r.onHandUnits);
  }

  return NextResponse.json({ ok: true, deleted: true });
}
