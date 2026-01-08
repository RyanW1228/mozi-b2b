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
      ownerAddress: string;
      plan: PlanOutput;
      pendingWindowHours?: number;
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

    const input = getState(locationId);

    const paymentIntent = buildPaymentIntentFromPlan({
      input,
      plan,
      pendingWindowHours: body.pendingWindowHours ?? 24,
    });

    const executeAfter = Math.floor(
      Date.parse(paymentIntent.pendingUntil) / 1000
    );

    const ref = keccak256(toUtf8Bytes(paymentIntent.intentId));
    const restaurantId = keccak256(toUtf8Bytes(locationId));

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

      const amountToken = parseUnits(t.amountUsd.toFixed(2), 18);

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
