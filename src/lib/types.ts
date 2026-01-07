// src/lib/types.ts

export type RiskStrategy = "min_waste" | "balanced" | "min_stockouts";

export type OrderCadence = "daily" | "2x_week" | "weekly" | "custom";

/**
 * Inputs Mozi needs to propose a reorder plan for a single-location restaurant.
 * v1 scope: reorder existing SKUs (not new-product discovery).
 */
export type PlanInput = {
  restaurant: {
    id: string;
    name?: string;
    timezone: string;
    cadence: OrderCadence;
    planningHorizonDays: number;

    // ✅ who funds orders for this location (treasury owner)
    ownerAddress?: string;
  };

  ownerPrefs: {
    strategy: RiskStrategy;
    budgetCapUsd?: number; // optional for v1
    maxWastePercent?: number; // optional
    criticalSkus?: string[]; // bias toward never-stockout
    neverRunOutSkus?: string[]; // strongest version of critical
  };

  suppliers: Array<{
    supplierId: string;
    name: string;
    leadTimeDays: number;
    payoutAddress: string; // <-- ADD THIS (EVM address where supplier will claim/receive)
    orderDaysOfWeek?: Array<
      "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun"
    >;
    minOrderUsd?: number;
  }>;

  skus: Array<{
    sku: string; // unique id
    name: string;
    category?: string; // meat/produce/dairy/etc
    unit: "each" | "lb" | "oz" | "g" | "kg" | "case";
    shelfLifeDays: number;
    supplierId: string; // who we buy it from in v1

    // EXECUTION: required for computing payment amounts
    unitCostUsd: number; // since 1 mMNEE = $1
  }>;

  inventory: Array<{
    sku: string;
    onHandUnits: number;
    // optional: if you track expiring lots later
    expiresInDays?: number;
  }>;

  sales: {
    windowDays: number; // e.g. 7 or 28
    bySku: Array<{
      sku: string;
      unitsSold: number;
    }>;
  };

  context?: {
    season?: "spring" | "summer" | "fall" | "winter";
    upcomingEvents?: Array<{
      name: string; // e.g. "Super Bowl"
      date: string; // ISO "YYYY-MM-DD"
      expectedDemandLiftPercent?: number; // optional hint
    }>;
    notes?: string; // free text: "football weekend"
  };
};

/**
 * Output Mozi returns: a concrete reorder plan + explanations.
 * v1 scope: reorder existing SKUs only.
 */
export type PlanOutput = {
  generatedAt: string; // ISO timestamp
  horizonDays: number;

  orders: Array<{
    supplierId: string;
    orderDate: string; // ISO "YYYY-MM-DD"
    items: Array<{
      sku: string;
      orderUnits: number;
      reason: string; // short explanation
      riskNote?: "waste_risk" | "stockout_risk" | "balanced";
      confidence?: number; // 0..1 optional
    }>;
    subtotalUsd?: number; // optional for v1
  }>;

  summary: {
    keyDrivers: string[]; // 3-6 bullets
    warnings?: string[]; // e.g. missing costs, missing inventory
  };
};

// ---------------------------------------------------------------------------
// Execution-layer types (deterministic; separate from model planning output)
// ---------------------------------------------------------------------------

export type PaymentIntent = {
  intentId: string; // unique id for audit + idempotency
  createdAt: string; // ISO timestamp
  buyer: { id: string; timezone: string };

  // Optional linkage back to the plan that produced it
  planGeneratedAt?: string;

  // Pending window for human override (autonomy proceeds after this)
  pendingUntil: string; // ISO timestamp

  // What would be paid if executed
  transfers: Array<{
    supplierId: string;
    amountUsd: number; // v1 accounting unit
    memo?: string;
    items?: Array<{ sku: string; units: number; unitCostUsd?: number }>;
  }>;

  // Deterministic validation metadata
  validation: {
    budgetCapUsd?: number;
    totalUsd: number;
    warnings?: string[];
  };
};
