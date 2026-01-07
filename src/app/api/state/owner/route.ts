export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { isAddress } from "ethers";
import { setOwnerAddress } from "@/lib/stateStore";

function getLocationIdFromUrl(url: string): string | null {
  const u = new URL(url);
  const locationId = u.searchParams.get("locationId");
  return locationId && locationId.trim().length > 0 ? locationId : null;
}

export async function POST(req: Request) {
  const locationId = getLocationIdFromUrl(req.url);
  if (!locationId) {
    return NextResponse.json(
      { ok: false, error: "Missing locationId in query string" },
      { status: 400 }
    );
  }

  const body = (await req.json()) as { ownerAddress?: string };
  const ownerAddress = body?.ownerAddress ?? "";

  if (!ownerAddress || !isAddress(ownerAddress)) {
    return NextResponse.json(
      { ok: false, error: "Invalid ownerAddress" },
      { status: 400 }
    );
  }

  setOwnerAddress(locationId, ownerAddress);
  return NextResponse.json({ ok: true });
}
