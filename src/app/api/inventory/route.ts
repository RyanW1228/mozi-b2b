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

// Match the client normalizeSku() so keys line up.
function normalizeSku(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// Accept numbers OR numeric strings; clamp to int >= 0
function toNonNegInt(x: unknown): number | null {
  if (typeof x === "number" && Number.isFinite(x))
    return Math.max(0, Math.floor(x));
  if (typeof x === "string") {
    const n = Number(x);
    if (Number.isFinite(n)) return Math.max(0, Math.floor(n));
  }
  return null;
}

export async function GET(req: Request) {
  const locationId = getLocationIdFromUrl(req.url);
  console.log("[api/inventory][GET]", { locationId });

  if (!locationId) return jsonError("Missing locationId in query string", 400);

  const state = getState(locationId) as any;
  const inv = Array.isArray(state?.inventory) ? state.inventory : [];

  return NextResponse.json(inv, {
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

  const skuRaw = String(body?.sku ?? "").trim();
  const sku = normalizeSku(skuRaw);
  if (!sku) return jsonError("Missing sku", 400);

  const n = toNonNegInt(body?.onHandUnits);
  if (n === null) return jsonError("Missing or invalid onHandUnits", 400);

  patchInventory(locationId, sku, n);

  return NextResponse.json(
    { ok: true, sku, onHandUnits: n },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function DELETE(req: Request) {
  const locationId = getLocationIdFromUrl(req.url);
  console.log("[api/inventory][DELETE]", { locationId });

  if (!locationId) return jsonError("Missing locationId in query string", 400);

  const body = (await req.json().catch(() => null)) as { sku?: unknown } | null;

  const skuRaw = String(body?.sku ?? "").trim();
  const sku = normalizeSku(skuRaw);
  if (!sku) return jsonError("Missing sku", 400);

  const state = getState(locationId) as any;
  const before = Array.isArray(state?.inventory) ? state.inventory : [];
  const exists = before.some((r: any) => String(r?.sku ?? "") === sku);

  if (!exists) {
    return NextResponse.json(
      { ok: true, deleted: false },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  removeInventorySku(locationId, sku);

  return NextResponse.json(
    { ok: true, deleted: true },
    { headers: { "Cache-Control": "no-store" } }
  );
}
