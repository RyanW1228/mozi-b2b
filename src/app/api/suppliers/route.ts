// src/app/api/suppliers/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { deleteSupplier, getSuppliers, upsertSupplier } from "@/lib/stateStore";

function getLocationIdFromUrl(url: string): string | null {
  const u = new URL(url);
  const locationId = u.searchParams.get("locationId");
  return locationId && locationId.trim().length > 0 ? locationId : null;
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function toNonNegInt(x: unknown): number {
  if (typeof x !== "number" || !Number.isFinite(x)) return 0;
  return Math.max(0, Math.floor(x));
}

function asTrimmedString(x: unknown): string {
  return String(x ?? "").trim();
}

export async function GET(req: Request) {
  const locationId = getLocationIdFromUrl(req.url);
  console.log("[api/suppliers][GET]", { locationId });

  if (!locationId) return jsonError("Missing locationId in query string", 400);

  const suppliers = getSuppliers(locationId);
  return NextResponse.json({ ok: true, suppliers });
}

export async function POST(req: Request) {
  const locationId = getLocationIdFromUrl(req.url);
  console.log("[api/suppliers][POST]", { locationId });

  if (!locationId) return jsonError("Missing locationId in query string", 400);

  const body = (await req.json().catch(() => null)) as {
    supplierId?: unknown;
    name?: unknown;
    payoutAddress?: unknown;
    leadTimeDays?: unknown;
  } | null;

  const supplierId = asTrimmedString(body?.supplierId);
  const name = asTrimmedString(body?.name);
  const payoutAddress = asTrimmedString(body?.payoutAddress);

  // accept both number or numeric string (UI drafts often strings)
  const leadTimeRaw = body?.leadTimeDays;
  const leadTimeDays =
    typeof leadTimeRaw === "number"
      ? toNonNegInt(leadTimeRaw)
      : toNonNegInt(Number(leadTimeRaw));

  if (!supplierId) return jsonError("Missing supplierId", 400);
  if (!name) return jsonError("Missing name", 400);
  if (!payoutAddress) return jsonError("Missing payoutAddress", 400);

  upsertSupplier(locationId, { supplierId, name, payoutAddress, leadTimeDays });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const locationId = getLocationIdFromUrl(req.url);
  console.log("[api/suppliers][DELETE]", { locationId });

  if (!locationId) return jsonError("Missing locationId in query string", 400);

  const body = (await req.json().catch(() => null)) as {
    supplierId?: unknown;
  } | null;

  const supplierId = asTrimmedString(body?.supplierId);
  if (!supplierId) return jsonError("Missing supplierId", 400);

  const deleted = deleteSupplier(locationId, supplierId);
  return NextResponse.json({ ok: true, deleted });
}
