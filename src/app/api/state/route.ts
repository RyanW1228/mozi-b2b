// src/app/api/state/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { PlanInput } from "@/lib/types";
import { getState, setState } from "@/lib/stateStore";

function getLocationIdFromUrl(url: string): string | null {
  const u = new URL(url);
  const locationId = u.searchParams.get("locationId");
  return locationId && locationId.trim().length > 0 ? locationId : null;
}

export async function GET(req: Request) {
  const locationId = getLocationIdFromUrl(req.url);
  if (!locationId) {
    return NextResponse.json(
      { error: "Missing locationId in query string" },
      { status: 400 }
    );
  }

  return NextResponse.json(getState(locationId));
}

export async function PUT(req: Request) {
  const locationId = getLocationIdFromUrl(req.url);
  if (!locationId) {
    return NextResponse.json(
      { error: "Missing locationId in query string" },
      { status: 400 }
    );
  }

  const body = (await req.json()) as PlanInput;
  setState(locationId, body);
  return NextResponse.json({ ok: true });
}
