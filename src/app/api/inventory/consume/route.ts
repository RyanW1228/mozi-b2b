// src/app/api/inventory/consume/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getState, patchInventory } from "@/lib/stateStore";

type ConsumeLine = {
  sku: string;
  // units to subtract (positive number). If you want to add stock, pass a negative number.
  units: number;
};

function getLocationIdFromUrl(url: string): string | null {
  const u = new URL(url);
  const locationId = u.searchParams.get("locationId");
  return locationId && locationId.trim().length > 0 ? locationId : null;
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function clampNonNegative(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

/**
 * POST /api/inventory/consume?locationId=loc-1
 * Body:
 * {
 *   "lines": [
 *     { "sku": "chicken_breast", "units": 2 },
 *     { "sku": "romaine_lettuce", "units": 5 }
 *   ]
 * }
 *
 * Semantics:
 * - For each line: newOnHand = max(0, currentOnHand - units)
 * - Uses Option A: patchInventory(locationId, sku, newOnHand) per SKU
 */
export async function POST(req: Request) {
  const locationId = getLocationIdFromUrl(req.url);
  if (!locationId) return jsonError("Missing locationId in query string", 400);

  const body = await req.json().catch(() => null);
  const lines = Array.isArray(body?.lines)
    ? (body.lines as ConsumeLine[])
    : null;

  if (!lines || lines.length === 0) {
    return jsonError(
      'Missing body.lines (array), e.g. { "lines": [{ "sku": "...", "units": 2 }] }',
      400
    );
  }

  // Snapshot current inventory so our loop is consistent
  const current = getState(locationId);
  const inv = Array.isArray(current.inventory) ? current.inventory : [];

  const currentBySku = new Map<string, number>();
  for (const row of inv) {
    const sku = String((row as any)?.sku ?? "");
    const onHand = Number((row as any)?.onHandUnits ?? 0);
    if (sku) currentBySku.set(sku, clampNonNegative(onHand));
  }

  const applied: Array<{
    sku: string;
    before: number;
    after: number;
    consumed: number;
  }> = [];

  for (const line of lines) {
    const sku = String(line?.sku ?? "").trim();
    const units = Number(line?.units ?? 0);

    if (!sku) continue;
    if (!Number.isFinite(units)) continue;

    const before = currentBySku.get(sku) ?? 0;

    // treat positive units as "consume"
    const consume = Math.max(0, Math.floor(units));
    const after = clampNonNegative(before - consume);

    // ✅ Option A: patch per SKU (3 args)
    patchInventory(locationId, sku, after);

    currentBySku.set(sku, after);
    applied.push({ sku, before, after, consumed: consume });
  }

  // Return fresh state
  const nextState = getState(locationId);

  return NextResponse.json({
    ok: true,
    locationId,
    applied,
    inventory: nextState.inventory ?? [],
  });
}
