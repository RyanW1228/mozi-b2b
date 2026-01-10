// src/app/api/state/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { PlanInput } from "@/lib/types";
import { getState, setState } from "@/lib/stateStore";
import { pipelineBySku } from "@/lib/intentStore";

function getLocationIdFromUrl(url: string): string | null {
  const u = new URL(url);
  const locationId = u.searchParams.get("locationId");
  return locationId && locationId.trim().length > 0 ? locationId : null;
}

function getOwnerFromUrl(url: string): string | null {
  const u = new URL(url);
  const owner = u.searchParams.get("owner");
  return owner && owner.trim().length > 0 ? owner : null;
}

function getEnvFromUrl(url: string): "testing" | "production" {
  const u = new URL(url);
  const env = (u.searchParams.get("env") ?? "").trim();
  return env === "production" ? "production" : "testing";
}

type PipelineItem = {
  sku: string;
  units: number;
  supplierId?: string;
  etaUnix?: number;
};

type PipelineIntent = {
  ref: string;
  env?: "testing" | "production";
  ownerAddress: string;
  locationId: string;
  executeAfterUnix?: number;
  createdAtUnix?: number;
  items?: PipelineItem[];
};

function num(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function GET(req: Request) {
  const locationId = getLocationIdFromUrl(req.url);
  const ownerAddress = getOwnerFromUrl(req.url) ?? "";
  const env = getEnvFromUrl(req.url);

  if (!locationId) {
    return NextResponse.json(
      { error: "Missing locationId in query string" },
      { status: 400 }
    );
  }

  const base = getState(locationId) as PlanInput;

  const nowUnix = Math.floor(Date.now() / 1000);
  const horizonDays = Math.max(
    1,
    num(base?.restaurant?.planningHorizonDays ?? 7)
  );
  const horizonEndUnix = nowUnix + horizonDays * 86400;

  // inventory map (source of truth for "arrived on hand")
  const inventoryMap = new Map<string, number>();
  for (const row of (base as any)?.inventory ?? []) {
    const sku = String(row?.sku ?? "");
    if (!sku) continue;
    inventoryMap.set(sku, num(row?.onHandUnits));
  }

  // Pull pipeline from intentStore (written by /api/orders/propose via upsertIntent)
  const pipelineRaw: any = ownerAddress
    ? pipelineBySku({ env, ownerAddress, locationId, nowUnix })
    : { bySku: {}, open: [] };

  const open: PipelineIntent[] = Array.isArray(pipelineRaw?.open)
    ? pipelineRaw.open
    : [];

  // Compute inbound within horizon using etaUnix (arrival-aware)
  const inboundWithinHorizon: Record<string, number> = {};

  for (const intent of open) {
    for (const it of intent?.items ?? []) {
      const sku = String(it?.sku ?? "");
      if (!sku) continue;

      const units = num(it?.units);
      if (units <= 0) continue;

      const etaUnix = num(it?.etaUnix);

      // If we have an ETA, only count it if it arrives within the horizon.
      // If ETA is missing, still count it (MVP fallback).
      const countIt = !etaUnix || etaUnix <= horizonEndUnix;
      if (!countIt) continue;

      inboundWithinHorizon[sku] = (inboundWithinHorizon[sku] ?? 0) + units;
    }
  }

  // Build skus[] for planning: (arrived inventory) + (inbound arriving within horizon)
  const skus = (base?.skus ?? []).map((s: any) => {
    const sku = String(s?.sku ?? "");
    const arrivedOnHand = inventoryMap.get(sku) ?? num(s?.onHandUnits);
    const inbound = num(inboundWithinHorizon[sku] ?? 0);

    return {
      ...s,
      onHandUnits: arrivedOnHand + inbound,
      inboundUnits: inbound, // debug / model signal
    };
  });

  const context = {
    ...(base?.context ?? {}),
    pipeline: {
      generatedAtUnix: nowUnix,
      horizonDays,
      horizonEndUnix,
      bySku: inboundWithinHorizon,
      open,
    },
  };

  return NextResponse.json({
    ...base,
    skus,
    context,
  });
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
