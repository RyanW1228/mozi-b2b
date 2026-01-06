import type { PlanInput, PlanOutput, PaymentIntent } from "@/lib/types";

function isoNow() {
  return new Date().toISOString();
}

function addDaysISO(iso: string, days: number) {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

// mMNEE pegged to USD => 1 mMNEE == $1 (accounting)
// So amountUsd is what we will later convert to token units on-chain.
export function buildPaymentIntentFromPlan(args: {
  input: PlanInput;
  plan: PlanOutput;
  pendingWindowHours?: number; // default 24
}): PaymentIntent {
  const { input, plan } = args;
  const pendingWindowHours = args.pendingWindowHours ?? 24;

  const createdAt = isoNow();
  const pendingUntil = addDaysISO(createdAt, pendingWindowHours / 24);

  // Fast lookup
  const skuById = new Map(input.skus.map((s) => [s.sku, s]));
  const supplierById = new Map(input.suppliers.map((s) => [s.supplierId, s]));

  // supplierId -> { amountUsd, items[] }
  const agg = new Map<
    string,
    {
      amountUsd: number;
      items: Array<{ sku: string; units: number; unitCostUsd?: number }>;
    }
  >();

  for (const order of plan.orders ?? []) {
    const supplier = supplierById.get(order.supplierId);
    if (!supplier) continue;

    for (const it of order.items ?? []) {
      const sku = skuById.get(it.sku);
      if (!sku) continue;

      const unitCostUsd = sku.unitCostUsd ?? 0; // deterministic fallback
      const lineUsd = unitCostUsd * it.orderUnits;

      const prev = agg.get(order.supplierId) ?? { amountUsd: 0, items: [] };
      prev.amountUsd += lineUsd;
      prev.items.push({ sku: it.sku, units: it.orderUnits, unitCostUsd });

      agg.set(order.supplierId, prev);
    }
  }

  const transfers = [...agg.entries()].map(([supplierId, v]) => ({
    supplierId,
    amountUsd: Number(v.amountUsd.toFixed(2)),
    items: v.items,
  }));

  const totalUsd = Number(
    transfers.reduce((sum, t) => sum + t.amountUsd, 0).toFixed(2)
  );

  const warnings: string[] = [];
  // Budget cap check
  if (
    typeof input.ownerPrefs.budgetCapUsd === "number" &&
    totalUsd > input.ownerPrefs.budgetCapUsd
  ) {
    warnings.push(
      `Total ${totalUsd} exceeds budgetCapUsd ${input.ownerPrefs.budgetCapUsd}`
    );
  }

  // Missing unit costs check
  for (const t of transfers) {
    for (const it of t.items ?? []) {
      if (!it.unitCostUsd || it.unitCostUsd <= 0) {
        warnings.push(`Missing/zero unitCostUsd for SKU ${it.sku}`);
        break;
      }
    }
  }

  const intent: PaymentIntent = {
    intentId: `intent_${Date.now()}`, // deterministic enough for MVP; we can improve later
    createdAt,
    buyer: { id: input.restaurant.id, timezone: input.restaurant.timezone },
    planGeneratedAt: plan.generatedAt,
    pendingUntil,
    transfers,
    validation: {
      budgetCapUsd: input.ownerPrefs.budgetCapUsd,
      totalUsd,
      warnings: warnings.length ? warnings : undefined,
    },
  };

  return intent;
}
