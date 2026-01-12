// src/app/api/orders/plan/route.ts
export const runtime = "nodejs";
export const maxDuration = 90;

import { NextResponse } from "next/server";
import { isAddress, keccak256, toUtf8Bytes, verifyMessage } from "ethers";

import { pipelineBySku } from "@/lib/intentStore";
import { getState } from "@/lib/stateStore";
import { generatePlan } from "@/lib/server/generatePlan";

import { buildPaymentIntentFromPlan } from "@/lib/pricing";
import { MOZI_TREASURY_HUB_ABI } from "@/lib/abis/moziTreasuryHub";

import { Interface, parseUnits } from "ethers";

const TREASURY_HUB_ADDRESS =
  process.env.NEXT_PUBLIC_MOZI_TREASURY_HUB_ADDRESS ?? "";

type ExecuteCall = { to: string; data: string };

// -------------------------
// Nonce store (shared pattern with /propose)
// -------------------------
declare global {
  // eslint-disable-next-line no-var
  var __moziNonceStore:
    | Map<string, { nonce: string; issuedAtMs: number }>
    | undefined;
}

function nonceStore() {
  if (!global.__moziNonceStore) global.__moziNonceStore = new Map();
  return global.__moziNonceStore;
}

function nonceKey(env: string, owner: string, locationId: string) {
  return `${env}:${owner.toLowerCase()}:${locationId}`;
}

// -------------------------
// Helpers (copied, minimal)
// -------------------------
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms
    );
    p.then((v) => {
      clearTimeout(id);
      resolve(v);
    }).catch((e) => {
      clearTimeout(id);
      reject(e);
    });
  });
}

function getLocationIdFromUrl(url: string): string | null {
  const u = new URL(url);
  const locationId = u.searchParams.get("locationId");
  return locationId && locationId.trim().length > 0 ? locationId : null;
}

function num(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Same as in /propose
 */
function buildBaseInputNoFetch(args: {
  env: "testing" | "production";
  locationId: string;
  ownerAddress: string;
}) {
  const { env, locationId, ownerAddress } = args;

  const base: any = getState(locationId);

  const nowUnix = Math.floor(Date.now() / 1000);
  const horizonDays = Math.max(
    1,
    num(base?.restaurant?.planningHorizonDays ?? 7)
  );
  const horizonEndUnix = nowUnix + horizonDays * 86400;

  const inventoryMap = new Map<string, number>();
  for (const row of base?.inventory ?? []) {
    const sku = String(row?.sku ?? "");
    if (!sku) continue;
    inventoryMap.set(sku, num(row?.onHandUnits));
  }

  const pipelineRaw: any = ownerAddress
    ? pipelineBySku({ env, ownerAddress, locationId, nowUnix })
    : { open: [] };

  const open = Array.isArray(pipelineRaw?.open) ? pipelineRaw.open : [];

  const inboundWithinHorizon: Record<string, number> = {};
  for (const intent of open) {
    for (const it of intent?.items ?? []) {
      const sku = String(it?.sku ?? "");
      if (!sku) continue;

      const units = num(it?.units);
      if (units <= 0) continue;

      const etaUnix = num(it?.etaUnix);
      const countIt = !etaUnix || etaUnix <= horizonEndUnix;
      if (!countIt) continue;

      inboundWithinHorizon[sku] = (inboundWithinHorizon[sku] ?? 0) + units;
    }
  }

  const skus = (base?.skus ?? []).map((s: any) => {
    const sku = String(s?.sku ?? "");
    const arrivedOnHand = inventoryMap.get(sku) ?? num(s?.onHandUnits);
    const inbound = num(inboundWithinHorizon[sku] ?? 0);

    return {
      ...s,

      // IMPORTANT:
      // - onHandUnits must mean "arrived/physically on hand"
      // - inbound stays in pipeline (context.pipelineBySku)
      // generatePlan will compute effectiveOnHandUnits = onHandUnits + pipelineUnits
      onHandUnits: arrivedOnHand,
      inboundUnits: inbound,
    };
  });

  const context = {
    ...(base?.context ?? {}),
    pipelineBySku: inboundWithinHorizon,
    pipelineOpen: open,
  };

  return { ...base, skus, context };
}

function buildCallsNoFetch(args: {
  locationId: string;
  ownerAddress: string;
  plan: any;
  pendingWindowHours: number;
}) {
  const { locationId, ownerAddress, plan, pendingWindowHours } = args;

  if (!TREASURY_HUB_ADDRESS) {
    throw new Error("Missing NEXT_PUBLIC_MOZI_TREASURY_HUB_ADDRESS in env");
  }

  const input = getState(locationId);

  const paymentIntent = buildPaymentIntentFromPlan({
    input,
    plan,
    pendingWindowHours,
  });

  const ref = keccak256(toUtf8Bytes(paymentIntent.intentId));
  const restaurantId = keccak256(toUtf8Bytes(locationId));

  const supplierPayout = new Map(
    (input.suppliers ?? []).map((s: any) => [
      String(s.supplierId),
      String(s.payoutAddress),
    ])
  );

  const iface = new Interface(MOZI_TREASURY_HUB_ABI);

  const calls = (paymentIntent.transfers ?? []).map((t: any) => {
    const supplier = supplierPayout.get(String(t.supplierId));
    if (!supplier || !isAddress(supplier)) {
      throw new Error(
        `Missing/invalid payoutAddress for supplierId=${t.supplierId}`
      );
    }

    const amountToken = parseUnits(Number(t.amountUsd ?? 0).toFixed(2), 18);

    const data = iface.encodeFunctionData("payOrderFor", [
      ownerAddress,
      supplier,
      amountToken,
      ref,
      restaurantId,
    ]);

    return { to: TREASURY_HUB_ADDRESS, data };
  });

  return { calls, ref, restaurantId, paymentIntent };
}

export async function POST(req: Request) {
  try {
    const locationId = getLocationIdFromUrl(req.url);
    if (!locationId) {
      return NextResponse.json(
        { ok: false, error: "Missing locationId in query string" },
        { status: 400 }
      );
    }

    const body = (await req.json()) as {
      env?: "testing" | "production";
      ownerAddress: string;

      auth?: {
        message: string;
        signature: string;
        nonce: string;
        issuedAtMs: number;
      };

      pendingWindowHours?: number;
      strategy?: string;
      horizonDays?: number;
      notes?: string;
    };

    const env = body.env ?? "testing";
    const ownerAddress = body.ownerAddress;

    if (!ownerAddress || !isAddress(ownerAddress)) {
      return NextResponse.json(
        { ok: false, error: "Invalid ownerAddress" },
        { status: 400 }
      );
    }

    // keep same guard as propose
    if (env !== "testing") {
      return NextResponse.json(
        { ok: false, error: "Planning disabled unless env=testing (Sepolia)" },
        { status: 400 }
      );
    }

    // --- MetaMask signature verification (same as propose) ---
    const auth = body.auth;
    const message = String(auth?.message ?? "");
    const signature = String(auth?.signature ?? "");
    const nonce = String(auth?.nonce ?? "");
    const issuedAtMs = Number(auth?.issuedAtMs ?? 0);

    if (!message || !signature || !nonce || !Number.isFinite(issuedAtMs)) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing auth fields (message/signature/nonce/issuedAtMs)",
        },
        { status: 401 }
      );
    }

    const k = nonceKey(env, ownerAddress, locationId);
    const record = nonceStore().get(k);

    if (!record || record.nonce !== nonce) {
      return NextResponse.json(
        { ok: false, error: "Invalid nonce" },
        { status: 401 }
      );
    }

    const NONCE_TTL_MS = 2 * 60 * 1000;
    if (Date.now() - record.issuedAtMs > NONCE_TTL_MS) {
      nonceStore().delete(k);
      return NextResponse.json(
        { ok: false, error: "Nonce expired" },
        { status: 401 }
      );
    }

    let recovered = "";
    try {
      recovered = verifyMessage(message, signature);
    } catch {
      return NextResponse.json(
        { ok: false, error: "Bad signature" },
        { status: 401 }
      );
    }

    if (recovered.toLowerCase() !== ownerAddress.toLowerCase()) {
      return NextResponse.json(
        {
          ok: false,
          error: "Signature does not match ownerAddress",
          recovered,
        },
        { status: 401 }
      );
    }

    // consume nonce
    nonceStore().delete(k);

    // 1) Build deterministic state WITHOUT self-fetch
    const baseInput = buildBaseInputNoFetch({ env, locationId, ownerAddress });
    if (!baseInput) {
      return NextResponse.json(
        {
          ok: false,
          error: "State is empty (getState returned null/undefined)",
        },
        { status: 500 }
      );
    }

    // 2) Apply knobs
    const input = {
      ...baseInput,
      restaurant: {
        ...(baseInput.restaurant ?? {}),
        id: locationId,
        planningHorizonDays:
          typeof body.horizonDays === "number"
            ? body.horizonDays
            : baseInput.restaurant?.planningHorizonDays ?? 7,
      },
      ownerPrefs: {
        ...(baseInput.ownerPrefs ?? {}),
        strategy: body.strategy ?? baseInput.ownerPrefs?.strategy ?? "balanced",
      },
      context: {
        ...(baseInput.context ?? {}),
        notes: body.notes ?? baseInput.context?.notes ?? "Normal week",
      },
    };

    // 3) Plan
    let plan: any;
    try {
      plan = await withTimeout(
        generatePlan(input as any),
        60_000,
        "generatePlan()"
      );
    } catch (e: any) {
      return NextResponse.json(
        {
          ok: false,
          error: "plan generation failed",
          where: "generatePlan()",
          detail: String(e?.message ?? e),
        },
        { status: 502 }
      );
    }

    if (!plan || !Array.isArray(plan?.orders)) {
      return NextResponse.json(
        {
          ok: false,
          error: "Invalid plan shape: plan.orders must be an array",
        },
        { status: 500 }
      );
    }

    // 4) Encode calls
    const exec = buildCallsNoFetch({
      locationId,
      ownerAddress,
      plan,
      pendingWindowHours: body.pendingWindowHours ?? 24,
    });

    const calls = (exec?.calls ?? []) as ExecuteCall[];
    if (!Array.isArray(calls) || calls.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No calls produced (nothing to pay)" },
        { status: 400 }
      );
    }

    const intent = {
      ref: exec.ref,
      owner: ownerAddress,
      restaurantId: exec.restaurantId,
      executeAfter:
        Math.floor(Date.now() / 1000) + (body.pendingWindowHours ?? 24) * 3600,
      approved: false,
      executed: false,
      canceled: false,

      // UI expects items[] with {orderId, supplier, amount, lines}
      items: (exec.paymentIntent?.transfers ?? []).map((t: any) => {
        // Build the same "lines" shape your UI reads (sku, qty, uom, name)
        // If your paymentIntent contains line-level detail elsewhere, use that.
        return {
          orderId: String(t?.orderId ?? ""), // or derive one
          supplier: String(
            (getState(locationId).suppliers ?? []).find(
              (s: any) => String(s.supplierId) === String(t.supplierId)
            )?.payoutAddress ?? ""
          ),
          amount: String(parseUnits(Number(t.amountUsd ?? 0).toFixed(2), 18)),
          executeAfter: Math.floor(Date.now() / 1000),
          lines: Array.isArray(t?.lines) ? t.lines : [], // if you don’t have lines, send []
        };
      }),
    };

    // IMPORTANT: this is a PLANNED object, not broadcast
    return NextResponse.json({
      ok: true,
      env,
      locationId,
      ownerAddress,
      intent,
      calls,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
