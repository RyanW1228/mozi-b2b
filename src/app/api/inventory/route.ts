// src/app/api/inventory/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { getState, patchInventory, removeInventorySku } from "@/lib/stateStore";

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
  return NextResponse.json(state.inventory, {
    headers: { "Cache-Control": "no-store" },
  });
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

  // Enforce integer, non-negative
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
  const exists = before.some((r) => r.sku === sku);

  // Idempotent delete
  if (!exists) {
    return NextResponse.json({ ok: true, deleted: false });
  }

  removeInventorySku(locationId, sku);
  return NextResponse.json({ ok: true, deleted: true });
}
