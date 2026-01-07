// src/app/api/cron/tick/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import {
  Interface,
  JsonRpcProvider,
  Wallet,
  isAddress,
  keccak256,
  parseUnits,
  toUtf8Bytes,
} from "ethers";

import { getState } from "@/lib/stateStore";
import { buildPaymentIntentFromPlan } from "@/lib/pricing";
import type { PlanOutput } from "@/lib/types";
import { MOZI_TREASURY_HUB_ABI } from "@/lib/abis/moziTreasuryHub";

const TREASURY_HUB_ADDRESS =
  process.env.NEXT_PUBLIC_MOZI_TREASURY_HUB_ADDRESS ?? "";

const AGENT_PK = process.env.MOZI_AGENT_PRIVATE_KEY ?? "";
const RPC_URL_SEPOLIA = process.env.RPC_URL_SEPOLIA ?? "";

// OPTIONAL (recommended later, not required for local)
const CRON_SECRET = process.env.MOZI_CRON_SECRET ?? "";

function getParam(url: string, key: string) {
  const u = new URL(url);
  const v = u.searchParams.get(key);
  return v && v.trim().length ? v.trim() : null;
}

export async function POST(req: Request) {
  try {
    // ---- optional auth gate (keep off for local if you want) ----
    if (CRON_SECRET) {
      const got = req.headers.get("x-mozicronsig");
      if (got !== CRON_SECRET) {
        return NextResponse.json(
          { ok: false, error: "unauthorized" },
          { status: 401 }
        );
      }
    }

    const locationId = getParam(req.url, "locationId");
    if (!locationId) {
      return NextResponse.json(
        { ok: false, error: "Missing locationId in query string" },
        { status: 400 }
      );
    }

    // For local MVP we pass ownerAddress in body (so server knows who the treasury owner is).
    const body = (await req.json().catch(() => ({}))) as {
      ownerAddress?: string;
      pendingWindowHours?: number;
    };

    const ownerAddress = body.ownerAddress ?? null;
    if (!ownerAddress || !isAddress(ownerAddress)) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Missing/invalid ownerAddress. Send JSON body: { ownerAddress: '0x...' }",
        },
        { status: 400 }
      );
    }

    if (!TREASURY_HUB_ADDRESS) {
      return NextResponse.json(
        { ok: false, error: "Missing NEXT_PUBLIC_MOZI_TREASURY_HUB_ADDRESS" },
        { status: 500 }
      );
    }
    if (!AGENT_PK) {
      return NextResponse.json(
        { ok: false, error: "Missing MOZI_AGENT_PRIVATE_KEY" },
        { status: 500 }
      );
    }
    if (!RPC_URL_SEPOLIA) {
      return NextResponse.json(
        { ok: false, error: "Missing RPC_URL_SEPOLIA" },
        { status: 500 }
      );
    }

    // 1) Load deterministic input for this location
    const input = getState(locationId);

    // 2) Ask your existing planner route for a plan
    const origin = new URL(req.url).origin;
    const planRes = await fetch(`${origin}/api/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });

    const planJson = (await planRes.json()) as any;
    if (!planRes.ok) {
      return NextResponse.json(
        { ok: false, error: "Planner failed", detail: planJson },
        { status: 500 }
      );
    }

    const plan = planJson as PlanOutput;

    // 3) Build payment intent (server-side)
    const paymentIntent = buildPaymentIntentFromPlan({
      input,
      plan,
      pendingWindowHours: body.pendingWindowHours ?? 24,
    });

    const executeAfter = Math.floor(
      Date.parse(paymentIntent.pendingUntil) / 1000
    );
    const ref = keccak256(toUtf8Bytes(paymentIntent.intentId));
    const restaurantId = keccak256(toUtf8Bytes(input.restaurant.id));

    // supplierId -> payout address
    const supplierPayout = new Map(
      input.suppliers.map((s) => [s.supplierId, s.payoutAddress])
    );

    // 4) Sign + send txs from agent wallet
    const provider = new JsonRpcProvider(RPC_URL_SEPOLIA);
    const agent = new Wallet(AGENT_PK, provider);

    const iface = new Interface(MOZI_TREASURY_HUB_ABI);

    // NOTE: 1 token == $1, 18 decimals
    const txs: Array<{ supplierId: string; hash: string }> = [];

    for (const t of paymentIntent.transfers) {
      const supplier = supplierPayout.get(t.supplierId);
      if (!supplier || !isAddress(supplier)) {
        return NextResponse.json(
          {
            ok: false,
            error: `Missing/invalid payoutAddress for supplierId=${t.supplierId}`,
          },
          { status: 400 }
        );
      }

      const amountToken = parseUnits(t.amountUsd.toFixed(2), 18);

      const data = iface.encodeFunctionData("proposeOrderFor", [
        ownerAddress,
        supplier,
        amountToken,
        executeAfter,
        ref,
        restaurantId,
      ]);

      const sent = await agent.sendTransaction({
        to: TREASURY_HUB_ADDRESS,
        data,
        value: 0,
      });

      txs.push({ supplierId: t.supplierId, hash: sent.hash });

      // wait so you can immediately see them in /orders/list
      await sent.wait();
    }

    return NextResponse.json({
      ok: true,
      locationId,
      ownerAddress,
      agentAddress: agent.address,
      paymentIntent,
      txs,
      note: "If a tx reverts, most common causes: autonomy not enabled (setAgent), insufficient available funds, invalid supplier payout address.",
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
