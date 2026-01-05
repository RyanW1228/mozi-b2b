// src/app/api/inventory/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getState, patchInventory } from "@/lib/stateStore";

function getLocationIdFromUrl(url: string): string | null {
  const u = new URL(url);
  const locationId = u.searchParams.get("locationId");
  return locationId && locationId.trim().length > 0 ? locationId : null;
}

export async function GET(req: Request) {
  const locationId = getLocationIdFromUrl(req.url);
  console.log("[api/inventory][GET]", { locationId });

  if (!locationId) {
    return NextResponse.json(
      { error: "Missing locationId in query string" },
      { status: 400 }
    );
  }

  const state = getState(locationId);
  return NextResponse.json(state.inventory);
}

export async function POST(req: Request) {
  const locationId = getLocationIdFromUrl(req.url);
  console.log("[api/inventory][GET]", { locationId });

  if (!locationId) {
    return NextResponse.json(
      { error: "Missing locationId in query string" },
      { status: 400 }
    );
  }

  const { sku, onHandUnits } = (await req.json()) as {
    sku: string;
    onHandUnits: number;
  };

  if (!sku || typeof onHandUnits !== "number") {
    return NextResponse.json(
      { error: "Missing sku or onHandUnits" },
      { status: 400 }
    );
  }

  patchInventory(locationId, sku, onHandUnits);
  return NextResponse.json({ ok: true });
}
