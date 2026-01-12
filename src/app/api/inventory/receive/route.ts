import { NextResponse } from "next/server";
import { getState, setState, addPipelineDec } from "@/lib/stateStore";

// NOTE: mirror the shape you used for /api/inventory/consume
type ReceiveLine = { sku: string; units: number };

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const locationId = url.searchParams.get("locationId") || "";
    if (!locationId) {
      return NextResponse.json(
        { ok: false, error: "Missing locationId" },
        { status: 400 }
      );
    }

    const body = await req.json().catch(() => null);
    const lines: ReceiveLine[] = Array.isArray(body?.lines) ? body.lines : [];

    if (!lines.length) {
      return NextResponse.json(
        { ok: false, error: "Missing lines[]" },
        { status: 400 }
      );
    }

    // sanitize
    const cleaned = lines
      .map((l) => ({
        sku: String(l?.sku ?? "").trim(),
        units: Math.max(0, Math.floor(Number(l?.units ?? 0))),
      }))
      .filter((l) => l.sku && l.units > 0);

    if (!cleaned.length) {
      return NextResponse.json(
        { ok: false, error: "No valid lines" },
        { status: 400 }
      );
    }

    const state = getState(locationId);
    const inv = Array.isArray((state as any)?.inventory)
      ? (state as any).inventory
      : [];

    const bySku = new Map<string, any>();
    for (const row of inv) {
      const sku = String(row?.sku ?? "");
      if (!sku) continue;
      bySku.set(sku, row);
    }

    for (const line of cleaned) {
      const row = bySku.get(line.sku);
      if (row) {
        const cur = Number(row.onHandUnits ?? 0);
        row.onHandUnits = Math.max(0, Math.floor(cur)) + line.units;
      } else {
        // If SKU wasn’t in inventory yet, add it
        inv.push({
          sku: line.sku,
          onHandUnits: line.units,
        });
      }
    }

    for (const line of cleaned) {
      addPipelineDec(locationId, line.sku, line.units);
    }

    (state as any).inventory = inv;
    setState(locationId, state);

    return NextResponse.json({ ok: true, applied: cleaned });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
