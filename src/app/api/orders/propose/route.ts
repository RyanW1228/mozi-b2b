// src/app/api/orders/propose/route.ts
export const runtime = "nodejs";
export const maxDuration = 90;

import { NextResponse } from "next/server";
import {
  isAddress,
  JsonRpcProvider,
  Wallet,
  keccak256,
  toUtf8Bytes,
  Interface,
  parseUnits,
  verifyMessage,
} from "ethers";

import { upsertIntent, pipelineBySku } from "@/lib/intentStore";
import { getState } from "@/lib/stateStore";
import { generatePlan } from "@/lib/server/generatePlan";

import { buildPaymentIntentFromPlan } from "@/lib/pricing";
import { MOZI_TREASURY_HUB_ABI } from "@/lib/abis/moziTreasuryHub";
import type { IntentRow } from "@/lib/types/intentRow";

const AGENT_PRIVATE_KEY = process.env.MOZI_AGENT_PRIVATE_KEY ?? "";
const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL ?? "";

const TREASURY_HUB_ADDRESS =
  process.env.NEXT_PUBLIC_MOZI_TREASURY_HUB_ADDRESS ?? "";

type ExecuteCall = { to: string; data: string };

// -------------------------
// Option A store (this is what /api/orders/list reads)
// -------------------------
type OrderLine = { sku: string; name?: string; qty: number; uom?: string };

type IntentItem = {
  orderId: string;
  supplier: string; // payout address
  amount: string; // raw token amount (18 decimals assumed)
  executeAfter?: number; // unix seconds
  lines: OrderLine[];

  // execution metadata
  txHash?: string;
  to?: string;
  createdAtUnix?: number;
};

function intentStore(): Map<string, IntentRow> {
  if (!global.__moziIntentStore) global.__moziIntentStore = new Map();
  return global.__moziIntentStore;
}

// -------------------------
// Signature replay store (no nonce roundtrip)
// -------------------------
declare global {
  // eslint-disable-next-line no-var
  var __moziSigReplayStore: Map<string, number> | undefined; // key -> expiresAtMs
}

function sigReplayStore() {
  if (!global.__moziSigReplayStore) global.__moziSigReplayStore = new Map();
  return global.__moziSigReplayStore;
}

// -------------------------
// Helpers
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

function asBytes32OrNull(v: any): string | null {
  const s = typeof v === "string" ? v : "";
  if (s.startsWith("0x") && s.length === 66) return s;
  return null;
}

function pickSupplierPayoutById(input: any): Map<string, string> {
  const m = new Map<string, string>();
  const sups = Array.isArray(input?.suppliers) ? input.suppliers : [];
  for (const s of sups) {
    const sid = String(s?.supplierId ?? "");
    const payout = String(s?.payoutAddress ?? "");
    if (sid && payout) m.set(sid, payout);
  }
  return m;
}

function normalizeUom(v: any): string | undefined {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s : undefined;
}

function num(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function dbgSku(s: any) {
  return {
    sku: String(s?.sku ?? ""),
    onHandUnits: Number(s?.onHandUnits ?? 0),
    inboundUnits: Number(s?.inboundUnits ?? 0),
    // these two are the BIG ones for whether the AI will order it
    avgDailyConsumption: s?.avgDailyConsumption,
    useByDays: s?.useByDays,
    // pricing + supplier for “amount=0” issues
    priceUsd: s?.priceUsd,
    supplierId: s?.supplierId,
    supplier: s?.supplier,
  };
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

/**
 * Build the same "pipeline-aware" PlanInput that /api/state returns,
 * but without doing an HTTP fetch to /api/state.
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

  // inventory map (arrived/on-hand)
  const inventoryMap = new Map<string, number>();
  for (const row of base?.inventory ?? []) {
    const sku = String(row?.sku ?? "");
    if (!sku) continue;
    inventoryMap.set(sku, num(row?.onHandUnits));
  }

  // pipeline from intentStore (written by upsertIntent)
  const pipelineRaw: any = ownerAddress
    ? pipelineBySku({ env, ownerAddress, locationId, nowUnix })
    : { open: [] };

  const open = Array.isArray(pipelineRaw?.open) ? pipelineRaw.open : [];

  // inbound that arrives within horizon
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

  // skus for planning = arrived + inbound
  const skus = (base?.skus ?? []).map((s: any) => {
    const sku = String(s?.sku ?? "");
    const arrivedOnHand = inventoryMap.get(sku) ?? num(s?.onHandUnits);
    const inbound = num(inboundWithinHorizon[sku] ?? 0);

    return {
      ...s,
      onHandUnits: arrivedOnHand + inbound,
      inboundUnits: inbound,
    };
  });

  // IMPORTANT: your /api/plan currently reads context.pipelineBySku (NOT context.pipeline.bySku)
  const context = {
    ...(base?.context ?? {}),
    pipelineBySku: inboundWithinHorizon,
    pipelineOpen: open,
  };

  return { ...base, skus, context };
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
        issuedAtMs: number;
      };

      pendingWindowHours?: number;

      strategy?: string;
      horizonDays?: number;
      notes?: string;

      // OPTIONAL: if you want server to use your simulated click time
      clientExecUnix?: number;
    };

    const env = body.env ?? "testing";
    const ownerAddress = body.ownerAddress;

    if (!ownerAddress || !isAddress(ownerAddress)) {
      return NextResponse.json(
        { ok: false, error: "Invalid ownerAddress" },
        { status: 400 }
      );
    }

    // ✅ Guard: only Sepolia for now
    if (env !== "testing") {
      return NextResponse.json(
        { ok: false, error: "Broadcast disabled unless env=testing (Sepolia)" },
        { status: 400 }
      );
    }

    // -------------------------
    // ✅ MetaMask signature verification (NO NONCE)
    // -------------------------
    const auth = body.auth;

    const message = String(auth?.message ?? "");
    const signature = String(auth?.signature ?? "");
    const issuedAtMs = Number(auth?.issuedAtMs ?? 0);

    if (
      !message ||
      !signature ||
      !Number.isFinite(issuedAtMs) ||
      issuedAtMs <= 0
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing auth fields (message/signature/issuedAtMs)",
        },
        { status: 401 }
      );
    }

    // 1) Freshness window (prevents old replays)
    const SIG_TTL_MS = 2 * 60 * 1000; // 2 minutes
    if (Math.abs(Date.now() - issuedAtMs) > SIG_TTL_MS) {
      return NextResponse.json(
        { ok: false, error: "Signature expired (issuedAtMs too old)" },
        { status: 401 }
      );
    }

    // 2) Basic message binding checks (prevents signing a generic message)
    const mustContain = [
      `Mozi: Generate Orders`,
      `env: ${env}`,
      `locationId: ${locationId}`,
      `owner: ${ownerAddress}`,
      `issuedAtMs: ${issuedAtMs}`,
    ];

    for (const s of mustContain) {
      if (!message.includes(s)) {
        return NextResponse.json(
          { ok: false, error: `Auth message missing: ${s}` },
          { status: 401 }
        );
      }
    }

    // 3) Verify signature recovers ownerAddress
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

    // 4) Replay protection WITHOUT nonce: short-TTL dedupe on signature hash
    const replayKey = keccak256(toUtf8Bytes(signature)); // stable-ish key
    const store = sigReplayStore();

    // lazy GC
    for (const [k, exp] of store.entries()) {
      if (exp <= Date.now()) store.delete(k);
    }

    if (store.has(replayKey)) {
      return NextResponse.json(
        { ok: false, error: "Replay detected (signature already used)" },
        { status: 401 }
      );
    }

    store.set(replayKey, Date.now() + SIG_TTL_MS);

    // 1) Build deterministic state WITHOUT self-fetch
    const baseInput = buildBaseInputNoFetch({
      env,
      locationId,
      ownerAddress,
    });

    if (!baseInput) {
      return NextResponse.json(
        {
          ok: false,
          error: "State is empty (getState returned null/undefined)",
        },
        { status: 500 }
      );
    }

    // 2) Apply “control knobs” (same as UI)
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

    // 3) Generate plan (NO self-fetch)
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

    if (!Array.isArray(plan?.orders) || plan.orders.length === 0) {
      const warnings = Array.isArray(plan?.summary?.warnings)
        ? plan.summary.warnings
        : [];
      return NextResponse.json(
        {
          ok: false,
          error:
            "No orders were generated. Fix missing SKU usage/pricing and try again.",
          where: "generatePlan()",
          detail: warnings.length
            ? warnings.join(" ")
            : "Planner returned 0 orders.",
          planSummary: plan?.summary ?? null,
        },
        { status: 400 }
      );
    }

    // 4) Build encoded calls (NO self-fetch)
    let execJson: any;
    try {
      execJson = buildCallsNoFetch({
        locationId,
        ownerAddress,
        plan,
        pendingWindowHours: body.pendingWindowHours ?? 24,
      });
    } catch (e: any) {
      const detail = String(e?.message ?? e);

      // Friendly message for the UI
      let userMessage =
        "Generate Orders didn’t create any payable orders. Check that your SKUs have usage (avgDailyConsumption) and pricing (unitCostUsd).";

      // If our pricing layer emits the known “totalUsd=0” message, make it super explicit
      if (
        detail.includes("No payable transfers produced") ||
        detail.includes("totalUsd=0")
      ) {
        userMessage =
          "No orders were created because there was nothing payable (total = $0). This usually means the plan ordered 0 units or pricing/usage data is missing for some SKUs.";
      }

      return NextResponse.json(
        {
          ok: false,
          error: userMessage, // 👈 show this to users
          where: "buildCallsNoFetch()",
          detail, // 👈 keep for debugging
        },
        { status: 400 } // 400 because it's a “nothing to pay / bad input data” situation
      );
    }

    const calls = (execJson?.calls ?? []) as ExecuteCall[];

    if (!Array.isArray(calls) || calls.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No calls produced (nothing to pay)" },
        { status: 400 }
      );
    }

    // 5) Broadcast calls as agent wallet (immediate execution)
    const provider = new JsonRpcProvider(SEPOLIA_RPC_URL);
    const agent = new Wallet(AGENT_PRIVATE_KEY, provider);

    const txs: { to: string; hash: string }[] = [];
    const createdAtUnix = Math.floor(Date.now() / 1000);

    const ref = execJson.ref;
    const restaurantId = execJson.restaurantId;

    // --- nonce + fee handling (prevents REPLACEMENT_UNDERPRICED) ---
    const fee = await provider.getFeeData();

    // Start from the *pending* nonce so we don't collide with already-pending txs
    let nextNonce = await provider.getTransactionCount(
      agent.address,
      "pending"
    );

    // Pick a reasonable bump. Sepolia can be finicky; 20–40% bump is common.
    function bump(big: bigint | null | undefined, pct: number) {
      if (!big) return null;
      return (big * BigInt(100 + pct)) / BigInt(100);
    }

    // If the RPC doesn't return EIP-1559 fields, fall back to gasPrice.
    const bumpedMaxFee = bump(fee.maxFeePerGas ?? null, 30);
    const bumpedMaxPrio = bump(fee.maxPriorityFeePerGas ?? null, 30);
    const bumpedGasPrice = bump(fee.gasPrice ?? null, 30);

    for (const c of calls) {
      if (!c?.to || !isAddress(c.to) || !c?.data) {
        return NextResponse.json(
          { ok: false, error: "Malformed call in calls[]", badCall: c },
          { status: 500 }
        );
      }

      const txRequest: any = {
        to: c.to,
        data: c.data,
        nonce: nextNonce++,
      };

      // Prefer EIP-1559 if available
      if (bumpedMaxFee && bumpedMaxPrio) {
        txRequest.maxFeePerGas = bumpedMaxFee;
        txRequest.maxPriorityFeePerGas = bumpedMaxPrio;
      } else if (bumpedGasPrice) {
        // Legacy fallback
        txRequest.gasPrice = bumpedGasPrice;
      }

      const tx = await withTimeout(
        agent.sendTransaction(txRequest),
        20_000,
        "sendTransaction"
      );
      txs.push({ to: c.to, hash: tx.hash });
    }

    // ✅ Write Option A IntentRow into __moziIntentStore so /api/orders/list can render it
    const payoutBySupplierId = pickSupplierPayoutById(input);
    const planOrders = Array.isArray(plan?.orders) ? plan.orders : [];

    const items: IntentItem[] = planOrders.map((o: any, idx: number) => {
      const supplierId = String(o?.supplierId ?? "");
      const supplierPayout =
        String(o?.supplierAddress ?? "") ||
        String(o?.payoutAddress ?? "") ||
        (supplierId ? payoutBySupplierId.get(supplierId) ?? "" : "");

      const rawAmount =
        String(o?.amount ?? "") ||
        String(o?.amountRaw ?? "") ||
        String(o?.totalAmount ?? "") ||
        String(o?.totalAmountRaw ?? "") ||
        "0";

      const lines: OrderLine[] = Array.isArray(o?.items)
        ? (o.items
            .map((it: any) => {
              const sku = String(it?.sku ?? "");
              const name = it?.name ? String(it.name) : undefined;

              const qtyNum = Number(
                it?.qty ?? it?.quantity ?? it?.orderUnits ?? 0
              );
              const qty = Number.isFinite(qtyNum) ? qtyNum : 0;

              const uom = normalizeUom(it?.uom);

              if (!sku || qty <= 0) return null;
              return { sku, name, qty, uom };
            })
            .filter(Boolean) as OrderLine[])
        : [];

      const txHit = txs[idx]; // best-effort

      return {
        orderId: String(o?.orderId ?? `${ref}:${idx}`),
        supplier: supplierPayout,
        amount: rawAmount,
        executeAfter: createdAtUnix,
        lines,
        txHash: txHit?.hash,
        to: txHit?.to,
        createdAtUnix,
      };
    });

    const intentRow: IntentRow = {
      ref,
      owner: ownerAddress,
      restaurantId,
      locationId,
      executeAfter: createdAtUnix,
      approved: true,
      executed: true,
      canceled: false,
      items: items.filter(
        (it) => Array.isArray(it.lines) && it.lines.length > 0
      ),
      createdAtUnix,
      env,
    };

    const storeKey = `${env}:${ownerAddress.toLowerCase()}:${locationId}:${ref.toLowerCase()}`;
    intentStore().set(storeKey, intentRow);

    // ✅ ALSO write pipeline snapshot (intentStore.ts) so /api/state can compute inbound
    try {
      const nowUnix = createdAtUnix;

      const supplierLeadDays = new Map<string, number>(
        (input?.suppliers ?? []).map((s: any) => [
          String(s?.supplierId ?? ""),
          Number(s?.leadTimeDays ?? 1),
        ])
      );

      const skuToSupplier = new Map<string, string>(
        (input?.skus ?? []).map((s: any) => [
          String(s?.sku ?? ""),
          String(s?.supplierId ?? ""),
        ])
      );

      function etaForSku(sku: string, fallbackSupplierId?: string) {
        const sup = fallbackSupplierId || skuToSupplier.get(sku) || "";
        const lead = supplierLeadDays.get(sup);
        const leadDays = Number.isFinite(lead as any) ? Number(lead) : 1;
        return nowUnix + Math.max(0, leadDays) * 86400;
      }

      const snapItems: Array<{
        sku: string;
        units: number;
        supplierId?: string;
        etaUnix: number;
      }> = [];

      for (const ord of planOrders) {
        const supplierId = String(ord?.supplierId ?? "");
        for (const it of ord?.items ?? []) {
          const sku = String(it?.sku ?? "");
          const units = Number(it?.orderUnits ?? it?.qty ?? it?.quantity ?? 0);
          if (!sku || !Number.isFinite(units) || units <= 0) continue;

          snapItems.push({
            sku,
            units,
            supplierId: supplierId || undefined,
            etaUnix: etaForSku(sku, supplierId),
          });
        }
      }

      upsertIntent({
        ref,
        env,
        ownerAddress,
        locationId,
        restaurantId,
        executeAfterUnix: nowUnix,
        createdAtUnix: nowUnix,
        items: snapItems,
      });
    } catch {
      // best-effort only
    }

    return NextResponse.json({
      ok: true,
      env,
      locationId,
      ownerAddress,
      agentAddress: agent.address,
      ref,
      txs,
      intent: intentRow,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
