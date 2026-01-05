export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { PlanInput, PlanOutput, PaymentIntent } from "@/lib/types";

type PreflightRequest = {
  input: PlanInput;
  plan: PlanOutput;
  pendingWindowMinutes?: number; // default 15
};

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as PreflightRequest;

    if (!body?.input || !body?.plan) {
      return NextResponse.json(
        { error: "Invalid request: expected { input, plan }" },
        { status: 400 }
      );
    }

    const { input, plan } = body;
    const pendingMinutes =
      isFiniteNumber(body.pendingWindowMinutes) && body.pendingWindowMinutes > 0
        ? Math.floor(body.pendingWindowMinutes)
        : 15;

    // Deterministic maps
    const supplierById = new Map(
      input.suppliers.map((s) => [s.supplierId, s] as const)
    );
    const skuById = new Map(input.skus.map((s) => [s.sku, s] as const));

    const warnings: string[] = [];

    // Build per-supplier totals deterministically using unitCostUsd
    const transfers: PaymentIntent["transfers"] = [];
    let totalUsd = 0;

    for (const order of plan.orders ?? []) {
      if (!supplierById.has(order.supplierId)) {
        warnings.push(`Plan includes unknown supplierId: ${order.supplierId}`);
        continue;
      }

      let supplierSubtotal = 0;
      const itemsForAudit: Array<{
        sku: string;
        units: number;
        unitCostUsd?: number;
      }> = [];

      for (const it of order.items ?? []) {
        const sku = skuById.get(it.sku);
        if (!sku) {
          warnings.push(`Plan includes unknown sku: ${it.sku}`);
          continue;
        }

        if (!isFiniteNumber(it.orderUnits) || it.orderUnits <= 0) continue;

        const unitCostUsd = sku.unitCostUsd;
        if (!isFiniteNumber(unitCostUsd)) {
          warnings.push(`Missing unitCostUsd for sku ${sku.sku} (${sku.name})`);
          continue; // without cost, we can't compute deterministic payment amount
        }

        const line = it.orderUnits * unitCostUsd;
        supplierSubtotal += line;
        itemsForAudit.push({
          sku: sku.sku,
          units: it.orderUnits,
          unitCostUsd,
        });
      }

      // Only include transfers that have a positive computed amount
      if (supplierSubtotal > 0) {
        supplierSubtotal = Math.round(supplierSubtotal * 100) / 100; // cents rounding
        totalUsd += supplierSubtotal;

        transfers.push({
          supplierId: order.supplierId,
          amountUsd: supplierSubtotal,
          memo: `Mozi inventory order ${order.orderDate}`,
          items: itemsForAudit,
        });
      }
    }

    totalUsd = Math.round(totalUsd * 100) / 100;

    // Enforce budget cap deterministically (preflight fails if exceeded)
    const budgetCapUsd = input.ownerPrefs.budgetCapUsd;
    if (isFiniteNumber(budgetCapUsd) && totalUsd > budgetCapUsd) {
      return NextResponse.json(
        {
          error: "Budget cap exceeded",
          budgetCapUsd,
          totalUsd,
          warnings,
        },
        { status: 400 }
      );
    }

    if (transfers.length === 0) {
      return NextResponse.json(
        {
          error: "No executable transfers computed",
          warnings: warnings.length ? warnings : ["No priced items in plan"],
        },
        { status: 400 }
      );
    }

    const now = new Date();
    const pendingUntil = new Date(now.getTime() + pendingMinutes * 60_000);

    const intent: PaymentIntent = {
      intentId: crypto.randomUUID(),
      createdAt: now.toISOString(),
      buyer: { id: input.restaurant.id, timezone: input.restaurant.timezone },
      planGeneratedAt: plan.generatedAt,
      pendingUntil: pendingUntil.toISOString(),
      transfers,
      validation: {
        budgetCapUsd: isFiniteNumber(budgetCapUsd) ? budgetCapUsd : undefined,
        totalUsd,
        warnings: warnings.length ? warnings : undefined,
      },
    };

    return NextResponse.json(intent);
  } catch (err: any) {
    return NextResponse.json(
      { error: "Preflight failed", detail: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
