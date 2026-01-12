import type { PlanInput, PlanOutput, PaymentIntent } from "@/lib/types";

function isoNow() {
  return new Date().toISOString();
}

function addDaysISO(iso: string, days: number) {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

function toFiniteNumber(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Number(n.toFixed(2));
}

/**
 * mMNEE pegged to USD => 1 mMNEE == $1 (accounting)
 * So amountUsd is what we will later convert to token units on-chain.
 *
 * IMPORTANT BEHAVIOR CHANGES (without breaking shape):
 * - We DO NOT silently produce empty/zero-dollar transfers.
 * - If everything would be $0 (e.g., missing/zero unit costs), we THROW a clear error
 *   so the caller can display a meaningful message instead of "nothing to pay".
 * - We add more specific warnings (still in validation.warnings).
 */
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
  const skuById = new Map((input.skus ?? []).map((s) => [String(s.sku), s]));
  const supplierById = new Map(
    (input.suppliers ?? []).map((s) => [String(s.supplierId), s])
  );

  const warnings: string[] = [];

  // supplierId -> { amountUsd, items[] }
  const agg = new Map<
    string,
    {
      amountUsd: number;
      items: Array<{ sku: string; units: number; unitCostUsd?: number }>;
    }
  >();

  for (const order of plan.orders ?? []) {
    const supplierId = String((order as any)?.supplierId ?? "");
    if (!supplierId) {
      warnings.push(`Plan order missing supplierId; skipped.`);
      continue;
    }

    const supplier = supplierById.get(supplierId);
    if (!supplier) {
      warnings.push(
        `Plan referenced unknown supplierId "${supplierId}"; skipped that supplier's items.`
      );
      continue;
    }

    for (const it of order.items ?? []) {
      const skuId = String((it as any)?.sku ?? "");
      const units = toFiniteNumber((it as any)?.orderUnits);

      if (!skuId) {
        warnings.push(
          `Plan item missing sku under supplier "${supplierId}"; skipped.`
        );
        continue;
      }
      if (!(units > 0)) continue; // ignore non-positive

      const sku = skuById.get(skuId);
      if (!sku) {
        warnings.push(
          `Plan referenced unknown sku "${skuId}" (supplier "${supplierId}"); skipped.`
        );
        continue;
      }

      // Prefer unitCostUsd; fallback to priceUsd if your state attaches it; otherwise 0.
      const unitCostUsd = (() => {
        const u = toFiniteNumber((sku as any)?.unitCostUsd);
        if (u > 0) return u;
        const p = toFiniteNumber((sku as any)?.priceUsd);
        if (p > 0) return p;
        return 0;
      })();

      if (!(unitCostUsd > 0)) {
        // DO NOT add a $0 line (it causes "nothing to pay" later). Record a clear warning instead.
        warnings.push(
          `Missing/zero unit cost for SKU "${skuId}" (supplier "${supplierId}"). ` +
            `Set unitCostUsd/priceUsd > 0 for this SKU.`
        );
        continue;
      }

      const lineUsd = unitCostUsd * units;
      if (!(lineUsd > 0)) continue;

      const prev = agg.get(supplierId) ?? { amountUsd: 0, items: [] };
      prev.amountUsd += lineUsd;
      prev.items.push({ sku: skuId, units, unitCostUsd });
      agg.set(supplierId, prev);
    }
  }

  // Build transfers, dropping any supplier bucket that ended up at $0
  const transfers = [...agg.entries()]
    .map(([supplierId, v]) => ({
      supplierId,
      amountUsd: round2(v.amountUsd),
      items: v.items,
    }))
    .filter((t) => t.amountUsd > 0 && (t.items?.length ?? 0) > 0);

  // Warn about supplier minimums (DO NOT block — just explain)
  for (const t of transfers) {
    const supplier = supplierById.get(t.supplierId);
    const min = toFiniteNumber((supplier as any)?.minOrderUsd);
    if (min > 0 && t.amountUsd < min) {
      warnings.push(
        `Supplier "${t.supplierId}" subtotal $${t.amountUsd.toFixed(
          2
        )} is below minOrderUsd $${min.toFixed(2)} (not blocking in MVP).`
      );
    }
  }

  const totalUsd = round2(transfers.reduce((sum, t) => sum + t.amountUsd, 0));

  // Budget cap check
  if (
    typeof (input as any)?.ownerPrefs?.budgetCapUsd === "number" &&
    totalUsd > (input as any).ownerPrefs.budgetCapUsd
  ) {
    warnings.push(
      `Total ${totalUsd} exceeds budgetCapUsd ${
        (input as any).ownerPrefs.budgetCapUsd
      }`
    );
  }

  // If there is literally nothing payable, THROW a clear error instead of returning an empty intent
  // (This is what prevents your "No calls produced (nothing to pay)" mystery.)
  if (transfers.length === 0 || !(totalUsd > 0)) {
    const details =
      warnings.length > 0
        ? `\nReasons:\n- ${warnings.join("\n- ")}`
        : `\nReasons:\n- Plan contained no payable items (all quantities <= 0 or missing pricing).`;

    throw new Error(
      `No payable transfers produced (totalUsd=${totalUsd}).${details}`
    );
  }

  const intent: PaymentIntent = {
    intentId: `intent_${Date.now()}`, // deterministic enough for MVP; we can improve later
    createdAt,
    buyer: { id: input.restaurant.id, timezone: input.restaurant.timezone },
    planGeneratedAt: plan.generatedAt,
    pendingUntil,
    transfers,
    validation: {
      budgetCapUsd: (input as any)?.ownerPrefs?.budgetCapUsd,
      totalUsd,
      warnings: warnings.length ? warnings : undefined,
    },
  };

  return intent;
}
