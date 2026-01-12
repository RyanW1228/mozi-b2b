// src/app/api/inventory/meta/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import {
  getInventoryMetaBySku,
  setInventoryMetaForSku,
  deleteInventoryMetaForSku,
} from "@/lib/stateStore";

type SkuMeta = {
  priceUsd: number;
  avgDailyConsumption: number;
  useByDays: number;
  supplier: string;
};

function getLocationIdFromUrl(url: string): string | null {
  const u = new URL(url);
  const locationId = u.searchParams.get("locationId");
  return locationId && locationId.trim().length > 0 ? locationId : null;
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

// Match the client normalizeSku() so keys line up.
function normalizeSku(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// Accept numbers OR numeric strings
function toNonNegNumber(x: unknown): number {
  if (typeof x === "number" && Number.isFinite(x)) return Math.max(0, x);
  if (typeof x === "string") {
    const n = Number(x);
    if (Number.isFinite(n)) return Math.max(0, n);
  }
  return 0;
}

// Accept numbers OR numeric strings; clamp to int >= 0
function toNonNegInt(x: unknown): number {
  if (typeof x === "number" && Number.isFinite(x))
    return Math.max(0, Math.floor(x));
  if (typeof x === "string") {
    const n = Number(x);
    if (Number.isFinite(n)) return Math.max(0, Math.floor(n));
  }
  return 0;
}

export async function GET(req: Request) {
  const locationId = getLocationIdFromUrl(req.url);
  console.log("[api/inventory/meta][GET]", { locationId });

  if (!locationId) return jsonError("Missing locationId in query string", 400);

  const metaBySku = getInventoryMetaBySku(locationId) ?? {};
  return NextResponse.json(
    { ok: true, metaBySku },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(req: Request) {
  const locationId = getLocationIdFromUrl(req.url);
  console.log("[api/inventory/meta][POST]", { locationId });

  if (!locationId) return jsonError("Missing locationId in query string", 400);

  const body = (await req.json().catch(() => null)) as {
    sku?: unknown;
    meta?: unknown;
  } | null;

  const skuRaw = String(body?.sku ?? "").trim();
  const sku = normalizeSku(skuRaw);
  if (!sku) return jsonError("Missing sku", 400);

  const metaRaw = body?.meta as Partial<SkuMeta> | undefined;
  if (!metaRaw || typeof metaRaw !== "object") {
    return jsonError("Missing meta", 400);
  }

  const supplier = String((metaRaw as any).supplier ?? "").trim();
  if (!supplier) return jsonError("Missing meta.supplier", 400);

  const meta: SkuMeta = {
    supplier,
    priceUsd: toNonNegNumber((metaRaw as any).priceUsd),
    avgDailyConsumption: toNonNegNumber((metaRaw as any).avgDailyConsumption),
    useByDays: toNonNegInt((metaRaw as any).useByDays),
  };

  setInventoryMetaForSku(locationId, sku, meta);

  console.log("[api/inventory/meta][POST] saved", { locationId, sku, meta });

  return NextResponse.json(
    { ok: true, sku, meta },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function DELETE(req: Request) {
  const locationId = getLocationIdFromUrl(req.url);
  console.log("[api/inventory/meta][DELETE]", { locationId });

  if (!locationId) return jsonError("Missing locationId in query string", 400);

  const body = (await req.json().catch(() => null)) as { sku?: unknown } | null;

  const skuRaw = String(body?.sku ?? "").trim();
  const sku = normalizeSku(skuRaw);
  if (!sku) return jsonError("Missing sku", 400);

  const deleted = deleteInventoryMetaForSku(locationId, sku);
  return NextResponse.json(
    { ok: true, deleted },
    { headers: { "Cache-Control": "no-store" } }
  );
}
