// src/app/lib/stateStore.ts
import type { PlanInput } from "@/lib/types";

// NOTE:
// This is an IN-MEMORY store for hackathon MVP purposes.
// It will reset on server restart or redeploy.

export type RestaurantState = PlanInput;

let state: RestaurantState = {
  restaurant: {
    id: "demo_restaurant_1",
    name: "Demo Restaurant",
    timezone: "America/New_York",
    cadence: "weekly",
    planningHorizonDays: 7,
  },
  ownerPrefs: {
    strategy: "balanced",
    maxWastePercent: 5,
    criticalSkus: ["chicken_breast", "ground_beef"],
  },
  suppliers: [
    { supplierId: "meatco", name: "MeatCo", leadTimeDays: 2 },
    { supplierId: "produceco", name: "ProduceCo", leadTimeDays: 1 },
  ],
  skus: [
    {
      sku: "chicken_breast",
      name: "Chicken Breast",
      unit: "lb",
      shelfLifeDays: 3,
      supplierId: "meatco",
      unitCostUsd: 3.5,
    },
    {
      sku: "ground_beef",
      name: "Ground Beef",
      unit: "lb",
      shelfLifeDays: 2,
      supplierId: "meatco",
      unitCostUsd: 4.0,
    },
    {
      sku: "romaine_lettuce",
      name: "Romaine Lettuce",
      unit: "each",
      shelfLifeDays: 5,
      supplierId: "produceco",
      unitCostUsd: 1.25,
    },
  ],
  inventory: [
    { sku: "chicken_breast", onHandUnits: 12 },
    { sku: "ground_beef", onHandUnits: 8 },
    { sku: "romaine_lettuce", onHandUnits: 20 },
  ],
  sales: {
    windowDays: 7,
    bySku: [
      { sku: "chicken_breast", unitsSold: 40 },
      { sku: "ground_beef", unitsSold: 35 },
      { sku: "romaine_lettuce", unitsSold: 22 },
    ],
  },
  context: {
    season: "winter",
    notes: "Normal week",
  },
};

export function getState() {
  return state;
}

export function setState(next: RestaurantState) {
  state = next;
}

export function patchInventory(sku: string, onHandUnits: number) {
  const inventory = [...state.inventory];
  const idx = inventory.findIndex((i) => i.sku === sku);

  if (idx >= 0) {
    inventory[idx] = { ...inventory[idx], onHandUnits };
  } else {
    inventory.push({ sku, onHandUnits });
  }

  state = { ...state, inventory };
}
