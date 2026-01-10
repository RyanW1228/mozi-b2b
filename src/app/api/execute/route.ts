// src/app/api/execute/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import {
  keccak256,
  toUtf8Bytes,
  isAddress,
  parseUnits,
  Interface,
} from "ethers";
import { getState } from "@/lib/stateStore";
import type { PlanOutput } from "@/lib/types";
import { buildPaymentIntentFromPlan } from "@/lib/pricing";
import { MOZI_TREASURY_HUB_ABI } from "@/lib/abis/moziTreasuryHub";

// Hub address (same one your UI uses)
const TREASURY_HUB_ADDRESS =
  process.env.NEXT_PUBLIC_MOZI_TREASURY_HUB_ADDRESS ?? "";

function getLocationIdFromUrl(url: string): string | null {
  const u = new URL(url);
  const locationId = u.searchParams.get("locationId");
  return locationId && locationId.trim().length > 0 ? locationId : null;
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

    if (!TREASURY_HUB_ADDRESS) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing NEXT_PUBLIC_MOZI_TREASURY_HUB_ADDRESS in env",
        },
        { status: 500 }
      );
    }

    const body = (await req.json()) as {
      ownerAddress: string;
      plan: PlanOutput;
      // NOTE: pendingWindowHours is now ignored (no on-chain pending),
      // but we accept it for backward compatibility with callers.
      pendingWindowHours?: number;
    };

    const ownerAddress = body?.ownerAddress;
    const plan = body?.plan;

    if (!ownerAddress || !isAddress(ownerAddress)) {
      return NextResponse.json(
        { ok: false, error: "Invalid ownerAddress" },
        { status: 400 }
      );
    }

    if (!plan || !Array.isArray((plan as any).orders)) {
      return NextResponse.json(
        { ok: false, error: "Invalid plan" },
        { status: 400 }
      );
    }

    const input = getState(locationId);

    // Still useful: groups/amounts per supplier + stable intentId
    const paymentIntent = buildPaymentIntentFromPlan({
      input,
      plan,
      pendingWindowHours: body.pendingWindowHours ?? 24,
    });

    // New contract: no executeAfter, no pending period.
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

      // NOTE: you were using 18 decimals before. Keep consistent with your MNEE token.
      // If MNEE has different decimals, change 18 here.
      const amountToken = parseUnits(Number(t.amountUsd ?? 0).toFixed(2), 18);

      const data = iface.encodeFunctionData("payOrderFor", [
        ownerAddress,
        supplier,
        amountToken,
        ref,
        restaurantId,
      ]);

      return {
        supplierId: String(t.supplierId),
        supplierPayoutAddress: supplier,
        amountUsd: Number(t.amountUsd ?? 0),
        amountToken: amountToken.toString(),

        to: TREASURY_HUB_ADDRESS,
        data,
      };
    });

    return NextResponse.json({
      ok: true,
      paymentIntent,
      hub: TREASURY_HUB_ADDRESS,
      ref,
      restaurantId,
      calls,
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "Failed to build execution calls",
        detail: String(e?.message ?? e),
      },
      { status: 500 }
    );
  }
}
