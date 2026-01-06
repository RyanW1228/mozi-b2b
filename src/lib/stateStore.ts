// src/lib/stateStore.ts
import type { PlanInput } from "@/lib/types";

// NOTE:
// This is an IN-MEMORY store for hackathon MVP purposes.
// It will reset on server restart or redeploy.

export type RestaurantState = PlanInput;

// Seed template used to initialize new locations.
// We will clone it and override restaurant.id per location.
const SEED_STATE: RestaurantState = {
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
    {
      supplierId: "meatco",
      name: "MeatCo",
      leadTimeDays: 2,
      payoutAddress: "0x0000000000000000000000000000000000000001",
    },
    {
      supplierId: "produceco",
      name: "ProduceCo",
      leadTimeDays: 1,
      payoutAddress: "0x0000000000000000000000000000000000000002",
    },
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

// In-memory per-location map
const statesByLocationId = new Map<string, RestaurantState>();

function cloneSeedForLocation(locationId: string): RestaurantState {
  // Deep clone to prevent cross-location mutation through shared references
  const cloned = structuredClone(SEED_STATE) as RestaurantState;
  cloned.restaurant.id = locationId;
  // Optional: name can default to location id if not set elsewhere
  if (!cloned.restaurant.name) cloned.restaurant.name = locationId;
  return cloned;
}

export function getState(locationId: string): RestaurantState {
  const existing = statesByLocationId.get(locationId);
  if (existing) return existing;

  const created = cloneSeedForLocation(locationId);
  statesByLocationId.set(locationId, created);
  return created;
}

export function setState(locationId: string, next: RestaurantState) {
  // Ensure state is scoped correctly
  const normalized = {
    ...next,
    restaurant: { ...next.restaurant, id: locationId },
  };
  statesByLocationId.set(locationId, normalized);
}

export function patchInventory(
  locationId: string,
  sku: string,
  onHandUnits: number
) {
  const current = getState(locationId);
  const inventory = [...current.inventory];
  const idx = inventory.findIndex((i) => i.sku === sku);

  if (idx >= 0) {
    inventory[idx] = { ...inventory[idx], onHandUnits };
  } else {
    inventory.push({ sku, onHandUnits });
  }

  const next = { ...current, inventory };
  statesByLocationId.set(locationId, next);
}
