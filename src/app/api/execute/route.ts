export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { keccak256, toUtf8Bytes, isAddress, parseUnits } from "ethers";
import { getState } from "@/lib/stateStore";
import type { PlanOutput } from "@/lib/types";
import { buildPaymentIntentFromPlan } from "@/lib/pricing";
import { MOZI_TREASURY_HUB_ABI } from "@/lib/abis/moziTreasuryHub";

// Your hub address (same one your UI uses)
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
        { error: "Missing locationId in query string" },
        { status: 400 }
      );
    }

    if (!TREASURY_HUB_ADDRESS) {
      return NextResponse.json(
        { error: "Missing NEXT_PUBLIC_MOZI_TREASURY_HUB_ADDRESS in env" },
        { status: 500 }
      );
    }

    const body = (await req.json()) as {
      ownerAddress: string; // restaurant owner's wallet (the treasury owner)
      plan: PlanOutput;
      pendingWindowHours?: number; // optional override
    };

    const ownerAddress = body?.ownerAddress;
    const plan = body?.plan;

    if (!ownerAddress || !isAddress(ownerAddress)) {
      return NextResponse.json(
        { error: "Invalid ownerAddress" },
        { status: 400 }
      );
    }

    if (!plan || !Array.isArray(plan.orders)) {
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    }

    // Deterministic input comes from server state for this location
    const input = getState(locationId);

    // Build PaymentIntent on the server (prevents client tampering)
    const paymentIntent = buildPaymentIntentFromPlan({
      input,
      plan,
      pendingWindowHours: body.pendingWindowHours ?? 24,
    });

    // executeAfter = pendingUntil (autonomy can execute once window ends)
    const executeAfter = Math.floor(
      Date.parse(paymentIntent.pendingUntil) / 1000
    );

    // bytes32 metadata
    const ref = keccak256(toUtf8Bytes(paymentIntent.intentId));
    const restaurantId = keccak256(toUtf8Bytes(input.restaurant.id));

    // supplierId -> payout address
    const supplierPayout = new Map(
      input.suppliers.map((s) => [s.supplierId, s.payoutAddress])
    );

    const calls = paymentIntent.transfers.map((t) => {
      const supplier = supplierPayout.get(t.supplierId);
      if (!supplier || !isAddress(supplier)) {
        throw new Error(
          `Missing/invalid payoutAddress for supplierId=${t.supplierId}`
        );
      }

      // 1 mMNEE == $1, token has 18 decimals (we’ll assume 18 for now)
      const amountToken = parseUnits(t.amountUsd.toFixed(2), 18);

      // Encode calldata for proposeOrderFor(owner, supplier, amount, executeAfter, ref, restaurantId)
      // We return encoded data so you can inspect before sending.
      const iface = new (require("ethers").Interface)(MOZI_TREASURY_HUB_ABI);
      const data = iface.encodeFunctionData("proposeOrderFor", [
        ownerAddress,
        supplier,
        amountToken,
        executeAfter,
        ref,
        restaurantId,
      ]);

      return {
        supplierId: t.supplierId,
        supplierPayoutAddress: supplier,
        amountUsd: t.amountUsd,
        amountToken: amountToken.toString(),
        executeAfter,
        to: TREASURY_HUB_ADDRESS,
        data,
      };
    });

    return NextResponse.json({
      paymentIntent,
      hub: TREASURY_HUB_ADDRESS,
      calls,
      note: "These are ENCODED calls only (not broadcast). Next step is signing + sending with an agent key.",
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        error: "Failed to build execution calls",
        detail: String(e?.message ?? e),
      },
      { status: 500 }
    );
  }
}
