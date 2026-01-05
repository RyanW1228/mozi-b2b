// src/app/api/inventory/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getState, patchInventory } from "@/lib/stateStore";

export async function GET() {
  return NextResponse.json(getState().inventory);
}

export async function POST(req: Request) {
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

  patchInventory(sku, onHandUnits);
  return NextResponse.json({ ok: true });
}
