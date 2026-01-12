// src/app/api/state/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { PlanInput } from "@/lib/types";
import {
  getState,
  setState,
  getInventoryMetaBySku,
  getPipelineDecBySku,
} from "@/lib/stateStore";
import { pipelineBySku } from "@/lib/intentStore";
import type { SkuMeta } from "@/lib/types/inventory";

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

/**
 * ✅ Demo simulated time support:
 * If the frontend is time-traveling, it should call:
 *   /api/state?...&nowUnix=<demoNowUnix>
 * or:
 *   /api/state?...&demoNowUnix=<demoNowUnix>
 *
 * If absent/invalid, we fall back to real wall clock time.
 */
function getNowUnixFromUrlOrHeaders(req: Request): number {
  try {
    const u = new URL(req.url);

    const q1 = (u.searchParams.get("nowUnix") ?? "").trim();
    const q2 = (u.searchParams.get("demoNowUnix") ?? "").trim();

    const h1 = (req.headers.get("x-now-unix") ?? "").trim();
    const h2 = (req.headers.get("x-demo-now-unix") ?? "").trim();

    const pick = q1 || q2 || h1 || h2;
    const n = Number(pick);

    if (Number.isFinite(n) && n > 0) return Math.floor(n);

    return Math.floor(Date.now() / 1000);
  } catch {
    return Math.floor(Date.now() / 1000);
  }
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

  // ✅ Use DEMO simulated time if provided, otherwise real time.
  const nowUnix = getNowUnixFromUrlOrHeaders(req);

  const horizonDays = Math.max(
    1,
    num(base?.restaurant?.planningHorizonDays ?? 7)
  );
  const horizonEndUnix = nowUnix + horizonDays * 86400;

  // -----------------------------
  // Source-of-truth: arrived inventory (from base.inventory)
  // -----------------------------
  const inventory = Array.isArray((base as any)?.inventory)
    ? ((base as any).inventory as Array<any>)
    : [];

  const inventoryMap = new Map<string, number>();
  for (const row of inventory) {
    const sku = String(row?.sku ?? "");
    if (!sku) continue;
    inventoryMap.set(sku, num(row?.onHandUnits));
  }

  // -----------------------------
  // Source-of-truth: meta (daily usage / price / use-by / supplier name)
  // -----------------------------
  const inventoryMetaBySku = (getInventoryMetaBySku(locationId) ??
    {}) as Record<string, SkuMeta>;

  // -----------------------------
  // Pipeline (non-arrived orders)
  // -----------------------------
  const pipelineRaw: any = ownerAddress
    ? pipelineBySku({ env, ownerAddress, locationId, nowUnix })
    : { bySku: {}, open: [] };

  const open: PipelineIntent[] = Array.isArray(pipelineRaw?.open)
    ? pipelineRaw.open
    : [];

  const pipelineAllNonArrivedBySku: Record<string, number> =
    pipelineRaw?.bySku && typeof pipelineRaw.bySku === "object"
      ? (pipelineRaw.bySku as Record<string, number>)
      : {};

  // ✅ Server-side decrements recorded on /api/inventory/receive
  const pipelineDec = getPipelineDecBySku(locationId) ?? {};

  // ✅ Apply decrements to "all non-arrived" (so it drops when items arrive)
  const pipelineAllNonArrivedBySkuEffective: Record<string, number> = {
    ...pipelineAllNonArrivedBySku,
  };
  for (const [sku, decRaw] of Object.entries(pipelineDec)) {
    const dec = num(decRaw);
    if (dec <= 0) continue;
    pipelineAllNonArrivedBySkuEffective[sku] = Math.max(
      0,
      num(pipelineAllNonArrivedBySkuEffective[sku] ?? 0) - dec
    );
  }

  // inbound within horizon (arrival-aware)
  const inboundWithinHorizon: Record<string, number> = {};

  for (const intent of open) {
    for (const it of intent?.items ?? []) {
      const sku = String(it?.sku ?? "");
      if (!sku) continue;

      const units = num(it?.units);
      if (units <= 0) continue;

      const etaUnix = num(it?.etaUnix);

      // ✅ If ETA exists and it's already arrived, do NOT count it as inbound
      if (etaUnix > 0 && etaUnix <= nowUnix) continue;

      // If ETA missing: count it (MVP fallback)
      // If ETA present: only count if within horizon
      const countIt = !etaUnix || etaUnix <= horizonEndUnix;
      if (!countIt) continue;

      inboundWithinHorizon[sku] = (inboundWithinHorizon[sku] ?? 0) + units;
    }
  }

  // ✅ Apply decrements to inbound-within-horizon too
  for (const [sku, decRaw] of Object.entries(pipelineDec)) {
    const dec = num(decRaw);
    if (dec <= 0) continue;
    inboundWithinHorizon[sku] = Math.max(
      0,
      num(inboundWithinHorizon[sku] ?? 0) - dec
    );
  }

  // -----------------------------
  // Build skus[] for planning:
  // - onHandUnits seen by model = arrived inventory + inbound within horizon
  // - attach meta onto each sku (so generatePlan can use it)
  // -----------------------------
  const skus = (base?.skus ?? []).map((s: any) => {
    const sku = String(s?.sku ?? "");
    const arrivedOnHand = inventoryMap.get(sku) ?? num(s?.onHandUnits);

    const inboundWithin = num(inboundWithinHorizon[sku] ?? 0);
    const pipelineAll = num(pipelineAllNonArrivedBySkuEffective[sku] ?? 0);

    const meta = inventoryMetaBySku[sku];

    return {
      ...s,

      // model-visible "effective on hand" base
      onHandUnits: arrivedOnHand + inboundWithin,

      // ✅ meta fields for planning + UI
      priceUsd: num((meta as any)?.priceUsd ?? (s as any)?.priceUsd ?? 0),
      avgDailyConsumption: num(
        meta?.avgDailyConsumption ?? s?.avgDailyConsumption ?? 0
      ),
      useByDays: Math.max(
        0,
        Math.floor(num(meta?.useByDays ?? s?.useByDays ?? 0))
      ),
      supplier: String(meta?.supplier ?? s?.supplier ?? ""),

      // ✅ verification fields
      arrivedOnHandUnits: arrivedOnHand,
      inboundWithinHorizonUnits: inboundWithin,
      pipelineAllNonArrivedUnits: pipelineAll,
    };
  });

  const context = {
    ...(base?.context ?? {}),

    // Back-compat for generatePlan (it reads input.context.pipelineBySku)
    pipelineBySku: pipelineAllNonArrivedBySkuEffective,

    pipeline: {
      generatedAtUnix: nowUnix,
      horizonDays,
      horizonEndUnix,
      bySkuWithinHorizon: inboundWithinHorizon,
      bySkuAllNonArrived: pipelineAllNonArrivedBySkuEffective,
      open,
    },
  };

  return NextResponse.json({
    ...base,

    // expose these explicitly too (useful for any UI)
    inventory,
    inventoryMetaBySku,

    // ✅ include time fields for debugging/UI
    nowUnix,
    horizonDays,
    horizonEndUnix,

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
