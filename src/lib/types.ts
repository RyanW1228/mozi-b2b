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
    timezone: string; // e.g. "America/New_York"
    cadence: OrderCadence;
    planningHorizonDays: number; // e.g. 7
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
    orderDaysOfWeek?: Array<
      "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun"
    >; // optional
    minOrderUsd?: number; // optional
  }>;

  skus: Array<{
    sku: string; // unique id
    name: string;
    category?: string; // meat/produce/dairy/etc
    unit: "each" | "lb" | "oz" | "g" | "kg" | "case";
    shelfLifeDays: number;
    supplierId: string; // who we buy it from in v1
    unitCostUsd?: number; // optional, improves profit calc later
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
