// src/lib/stateStore.ts
import type { PlanInput } from "@/lib/types";

// NOTE:
// This is an IN-MEMORY store for hackathon MVP purposes.
// It will reset on server restart or redeploy.

export type RestaurantState = PlanInput;
export const __BOOT_ID = Math.random().toString(36).slice(2);

// Seed template used to initialize new locations.
// We will clone it and override restaurant.id per location.
const SEED_STATE: RestaurantState = {
  restaurant: {
    id: "demo_restaurant_1",
    name: "Demo Restaurant",
    timezone: "America/New_York",
    cadence: "weekly",
    planningHorizonDays: 7,
    ownerAddress: undefined,
  },

  ownerPrefs: {
    strategy: "balanced",
    maxWastePercent: 5,
    // keep some “critical” items so the plan has obvious priorities
    criticalSkus: ["chicken_breast", "ground_beef", "romaine_lettuce"],
    neverRunOutSkus: ["salt", "black_pepper", "olive_oil"],
  },

  suppliers: [
    {
      supplierId: "meatco",
      name: "MeatCo",
      leadTimeDays: 2,
      payoutAddress: "0xEd97C42cAA7eACd3F10aeC5B800f7a3e970437F8",
      orderDaysOfWeek: ["mon", "thu"],
      minOrderUsd: 75,
    },
    {
      supplierId: "produceco",
      name: "ProduceCo",
      leadTimeDays: 1,
      payoutAddress: "0x13706179d0408038ae3Bfc6a2FF19AD9Ac718935",
      orderDaysOfWeek: ["mon", "wed", "fri"],
      minOrderUsd: 50,
    },
    {
      supplierId: "dairyco",
      name: "DairyCo",
      leadTimeDays: 2,
      payoutAddress: "0x4B0897b0513fdC7C541B6d9D7E929C4e5364D2dB",
      orderDaysOfWeek: ["tue", "fri"],
      minOrderUsd: 60,
    },
    {
      supplierId: "drygoodsco",
      name: "DryGoodsCo",
      leadTimeDays: 3,
      payoutAddress: "0x583031D1113aD414F02576BD6afaBfb302140225",
      orderDaysOfWeek: ["wed"],
      minOrderUsd: 120,
    },
    {
      supplierId: "seafoodco",
      name: "SeafoodCo",
      leadTimeDays: 2,
      payoutAddress: "0xdD2FD4581271e230360230F9337D5c0430Bf44C0",
      orderDaysOfWeek: ["thu"],
      minOrderUsd: 90,
    },
  ],

  skus: [
    // MEAT
    {
      sku: "chicken_breast",
      name: "Chicken Breast",
      category: "meat",
      unit: "lb",
      shelfLifeDays: 3,
      supplierId: "meatco",
      unitCostUsd: 3.5,
    },
    {
      sku: "ground_beef",
      name: "Ground Beef",
      category: "meat",
      unit: "lb",
      shelfLifeDays: 2,
      supplierId: "meatco",
      unitCostUsd: 4.0,
    },
    {
      sku: "pork_shoulder",
      name: "Pork Shoulder",
      category: "meat",
      unit: "lb",
      shelfLifeDays: 3,
      supplierId: "meatco",
      unitCostUsd: 3.1,
    },
    {
      sku: "bacon",
      name: "Bacon",
      category: "meat",
      unit: "lb",
      shelfLifeDays: 7,
      supplierId: "meatco",
      unitCostUsd: 5.2,
    },

    // PRODUCE
    {
      sku: "romaine_lettuce",
      name: "Romaine Lettuce",
      category: "produce",
      unit: "each",
      shelfLifeDays: 5,
      supplierId: "produceco",
      unitCostUsd: 1.25,
    },
    {
      sku: "tomatoes",
      name: "Tomatoes",
      category: "produce",
      unit: "lb",
      shelfLifeDays: 6,
      supplierId: "produceco",
      unitCostUsd: 1.65,
    },
    {
      sku: "yellow_onions",
      name: "Yellow Onions",
      category: "produce",
      unit: "lb",
      shelfLifeDays: 14,
      supplierId: "produceco",
      unitCostUsd: 0.85,
    },
    {
      sku: "garlic",
      name: "Garlic",
      category: "produce",
      unit: "lb",
      shelfLifeDays: 21,
      supplierId: "produceco",
      unitCostUsd: 2.3,
    },
    {
      sku: "lemons",
      name: "Lemons",
      category: "produce",
      unit: "each",
      shelfLifeDays: 10,
      supplierId: "produceco",
      unitCostUsd: 0.65,
    },

    // DAIRY
    {
      sku: "whole_milk",
      name: "Whole Milk",
      category: "dairy",
      unit: "case",
      shelfLifeDays: 10,
      supplierId: "dairyco",
      unitCostUsd: 28,
    },
    {
      sku: "butter",
      name: "Butter",
      category: "dairy",
      unit: "lb",
      shelfLifeDays: 30,
      supplierId: "dairyco",
      unitCostUsd: 3.9,
    },
    {
      sku: "mozzarella",
      name: "Mozzarella",
      category: "dairy",
      unit: "lb",
      shelfLifeDays: 12,
      supplierId: "dairyco",
      unitCostUsd: 4.75,
    },

    // DRY GOODS
    {
      sku: "flour",
      name: "All-Purpose Flour",
      category: "dry_goods",
      unit: "lb",
      shelfLifeDays: 90,
      supplierId: "drygoodsco",
      unitCostUsd: 0.6,
    },
    {
      sku: "rice",
      name: "Jasmine Rice",
      category: "dry_goods",
      unit: "lb",
      shelfLifeDays: 180,
      supplierId: "drygoodsco",
      unitCostUsd: 1.1,
    },
    {
      sku: "olive_oil",
      name: "Olive Oil",
      category: "dry_goods",
      unit: "case",
      shelfLifeDays: 365,
      supplierId: "drygoodsco",
      unitCostUsd: 52,
    },
    {
      sku: "salt",
      name: "Kosher Salt",
      category: "dry_goods",
      unit: "case",
      shelfLifeDays: 365,
      supplierId: "drygoodsco",
      unitCostUsd: 18,
    },
    {
      sku: "black_pepper",
      name: "Black Pepper",
      category: "dry_goods",
      unit: "case",
      shelfLifeDays: 365,
      supplierId: "drygoodsco",
      unitCostUsd: 26,
    },

    // SEAFOOD
    {
      sku: "salmon_fillet",
      name: "Salmon Fillet",
      category: "seafood",
      unit: "lb",
      shelfLifeDays: 2,
      supplierId: "seafoodco",
      unitCostUsd: 9.5,
    },
    {
      sku: "shrimp",
      name: "Shrimp (peeled)",
      category: "seafood",
      unit: "lb",
      shelfLifeDays: 2,
      supplierId: "seafoodco",
      unitCostUsd: 8.25,
    },
  ],

  // IMPORTANT: include every SKU here so Inventory UI always has data
  inventory: [
    { sku: "chicken_breast", onHandUnits: 12 },
    { sku: "ground_beef", onHandUnits: 8 },
    { sku: "pork_shoulder", onHandUnits: 10 },
    { sku: "bacon", onHandUnits: 6 },

    { sku: "romaine_lettuce", onHandUnits: 20 },
    { sku: "tomatoes", onHandUnits: 18 },
    { sku: "yellow_onions", onHandUnits: 25 },
    { sku: "garlic", onHandUnits: 6 },
    { sku: "lemons", onHandUnits: 30 },

    { sku: "whole_milk", onHandUnits: 4 },
    { sku: "butter", onHandUnits: 10 },
    { sku: "mozzarella", onHandUnits: 14 },

    { sku: "flour", onHandUnits: 60 },
    { sku: "rice", onHandUnits: 40 },
    { sku: "olive_oil", onHandUnits: 2 },
    { sku: "salt", onHandUnits: 3 },
    { sku: "black_pepper", onHandUnits: 2 },

    { sku: "salmon_fillet", onHandUnits: 8 },
    { sku: "shrimp", onHandUnits: 10 },
  ],

  // IMPORTANT: include every SKU here so planning has “signal”
  sales: {
    windowDays: 7,
    bySku: [
      { sku: "chicken_breast", unitsSold: 40 },
      { sku: "ground_beef", unitsSold: 35 },
      { sku: "pork_shoulder", unitsSold: 18 },
      { sku: "bacon", unitsSold: 14 },

      { sku: "romaine_lettuce", unitsSold: 22 },
      { sku: "tomatoes", unitsSold: 28 },
      { sku: "yellow_onions", unitsSold: 20 },
      { sku: "garlic", unitsSold: 6 },
      { sku: "lemons", unitsSold: 18 },

      { sku: "whole_milk", unitsSold: 3 },
      { sku: "butter", unitsSold: 6 },
      { sku: "mozzarella", unitsSold: 20 },

      { sku: "flour", unitsSold: 25 },
      { sku: "rice", unitsSold: 12 },
      { sku: "olive_oil", unitsSold: 1 },
      { sku: "salt", unitsSold: 1 },
      { sku: "black_pepper", unitsSold: 1 },

      { sku: "salmon_fillet", unitsSold: 16 },
      { sku: "shrimp", unitsSold: 14 },
    ],
  },

  context: {
    season: "winter",
    upcomingEvents: [
      {
        name: "Weekend Rush",
        date: "2026-01-10",
        expectedDemandLiftPercent: 15,
      },
      {
        name: "Local Sports Night",
        date: "2026-01-12",
        expectedDemandLiftPercent: 10,
      },
    ],
    notes:
      "Stable demand. Higher weekend traffic. Keep core proteins and salad items stocked; watch seafood spoilage.",
  },
};

// In-memory per-location map
const statesByLocationId = new Map<string, RestaurantState>();

// inventory meta stored separately from RestaurantState (PlanInput doesn't include it)
type InventoryMeta = {
  priceUsd: number;
  avgDailyConsumption: number;
  useByDays: number;
  supplier: string;
};

const inventoryMetaByLocationId = new Map<
  string,
  Record<string, InventoryMeta>
>();

function cloneSeedForLocation(locationId: string): RestaurantState {
  // Deep clone to prevent cross-location mutation through shared references
  const cloned = structuredClone(SEED_STATE) as RestaurantState;
  cloned.restaurant.id = locationId;
  if (!cloned.restaurant.name) cloned.restaurant.name = locationId;
  return cloned;
}

/**
 * ✅ NEW:
 * Seed per-location inventory meta from the seed SKUs + suppliers, if missing.
 *
 * - priceUsd: uses unitCostUsd
 * - useByDays: uses shelfLifeDays
 * - avgDailyConsumption: defaults to 0 (no seed data)
 * - supplier: supplier name derived from supplierId
 */
function seedInventoryMetaIfMissing(locationId: string) {
  if (inventoryMetaByLocationId.has(locationId)) return;

  const supplierNameById = new Map(
    (SEED_STATE.suppliers ?? []).map((s) => [s.supplierId, s.name])
  );

  const seeded: Record<string, InventoryMeta> = {};
  for (const s of SEED_STATE.skus ?? []) {
    seeded[s.sku] = {
      priceUsd:
        typeof (s as any).unitCostUsd === "number" ? (s as any).unitCostUsd : 0,
      avgDailyConsumption: 0,
      useByDays:
        typeof (s as any).shelfLifeDays === "number"
          ? (s as any).shelfLifeDays
          : 0,
      supplier: supplierNameById.get((s as any).supplierId) ?? "",
    };
  }

  inventoryMetaByLocationId.set(locationId, seeded);
}

// -------------------------
// Inventory meta helpers
// -------------------------
export function getInventoryMetaBySku(locationId: string) {
  seedInventoryMetaIfMissing(locationId);
  return inventoryMetaByLocationId.get(locationId) ?? {};
}

export function setInventoryMetaForSku(
  locationId: string,
  sku: string,
  meta: InventoryMeta
) {
  seedInventoryMetaIfMissing(locationId);
  const current = inventoryMetaByLocationId.get(locationId) ?? {};
  const next = { ...current, [sku]: meta };
  inventoryMetaByLocationId.set(locationId, next);
}

export function deleteInventoryMetaForSku(locationId: string, sku: string) {
  seedInventoryMetaIfMissing(locationId);
  const current = inventoryMetaByLocationId.get(locationId) ?? {};
  if (!(sku in current)) return false;

  const next = { ...current };
  delete next[sku];
  inventoryMetaByLocationId.set(locationId, next);
  return true;
}

// -------------------------
// Core state
// -------------------------
export function getState(locationId: string): RestaurantState {
  const existing = statesByLocationId.get(locationId);
  if (existing) return existing;

  const created = cloneSeedForLocation(locationId);
  statesByLocationId.set(locationId, created);

  // ✅ Ensure meta exists even if meta is requested immediately after state creation
  seedInventoryMetaIfMissing(locationId);

  return created;
}

export function setState(locationId: string, next: RestaurantState) {
  const normalized = {
    ...next,
    restaurant: { ...next.restaurant, id: locationId },
  };
  statesByLocationId.set(locationId, normalized);

  // ✅ Keep meta seeded for this location (no-op if already seeded)
  seedInventoryMetaIfMissing(locationId);
}

// -------------------------
// Inventory helpers
// -------------------------
export function patchInventory(
  locationId: string,
  sku: string,
  onHandUnits: number
) {
  const current = getState(locationId);
  const inventory = [...(current.inventory ?? [])];
  const idx = inventory.findIndex((i) => i.sku === sku);

  if (idx >= 0) {
    inventory[idx] = { ...inventory[idx], onHandUnits };
  } else {
    inventory.push({ sku, onHandUnits });
  }

  const next = { ...current, inventory };
  statesByLocationId.set(locationId, next);
}

export function removeInventorySku(locationId: string, sku: string) {
  const current = getState(locationId);
  const inventory = (current.inventory ?? []).filter((i) => i.sku !== sku);
  const next = { ...current, inventory };
  statesByLocationId.set(locationId, next);
}

export function setOwnerAddress(locationId: string, ownerAddress: string) {
  const current = getState(locationId);
  const next: RestaurantState = {
    ...current,
    restaurant: {
      ...current.restaurant,
      id: locationId,
      ownerAddress,
    },
  };
  statesByLocationId.set(locationId, next);
}

// -------------------------
// Suppliers helpers  ✅ NEW
// -------------------------
export type SupplierRow = RestaurantState["suppliers"][number];

export function getSuppliers(locationId: string): SupplierRow[] {
  const current = getState(locationId);
  return [...(current.suppliers ?? [])];
}

export function upsertSupplier(locationId: string, supplier: SupplierRow) {
  const current = getState(locationId);
  const suppliers = [...(current.suppliers ?? [])];
  const idx = suppliers.findIndex((s) => s.supplierId === supplier.supplierId);

  if (idx >= 0) {
    suppliers[idx] = { ...suppliers[idx], ...supplier };
  } else {
    suppliers.push(supplier);
  }

  const next: RestaurantState = { ...current, suppliers };
  statesByLocationId.set(locationId, next);

  // meta seed remains valid (no-op if already seeded)
  seedInventoryMetaIfMissing(locationId);
}

export function deleteSupplier(locationId: string, supplierId: string) {
  const current = getState(locationId);
  const before = current.suppliers ?? [];
  const after = before.filter((s) => s.supplierId !== supplierId);
  const deleted = after.length !== before.length;

  const next: RestaurantState = { ...current, suppliers: after };
  statesByLocationId.set(locationId, next);

  // meta seed remains valid (no-op if already seeded)
  seedInventoryMetaIfMissing(locationId);

  return deleted;
}
