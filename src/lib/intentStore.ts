// src/lib/intentStore.ts
export type IntentItem = {
  sku: string;
  units: number;
  supplierId?: string;
  etaUnix: number; // when we consider it "arrived"
};

export type IntentSnapshot = {
  ref: string; // bytes32 hex string
  ownerAddress: string;
  locationId: string;
  restaurantId: string; // bytes32 hex string
  executeAfterUnix: number; // unix seconds
  createdAtUnix: number;
  items: IntentItem[];
  // Optional lifecycle fields (we’ll keep for later)
  arrivedAtUnix?: number;
};

// Global in-memory store (fine for local + hackathon; later swap to DB)
declare global {
  // eslint-disable-next-line no-var
  var __moziIntentStore: Map<string, IntentSnapshot> | undefined;
}

function store(): Map<string, IntentSnapshot> {
  if (!global.__moziIntentStore) global.__moziIntentStore = new Map();
  return global.__moziIntentStore;
}

export function upsertIntent(i: IntentSnapshot) {
  // Key on owner+location+ref to avoid collisions
  const key = `${i.ownerAddress.toLowerCase()}::${
    i.locationId
  }::${i.ref.toLowerCase()}`;
  store().set(key, i);
}

export function listOpenIntents(args: {
  ownerAddress: string;
  locationId: string;
  nowUnix?: number;
}) {
  const now = args.nowUnix ?? Math.floor(Date.now() / 1000);
  const owner = args.ownerAddress.toLowerCase();
  const loc = args.locationId;

  const out: IntentSnapshot[] = [];
  for (const [, v] of store()) {
    if (v.ownerAddress.toLowerCase() !== owner) continue;
    if (v.locationId !== loc) continue;

    // Consider arrived if explicitly marked arrived OR all items past ETA
    const explicitlyArrived = typeof v.arrivedAtUnix === "number";
    const allPastEta =
      v.items.length > 0 && v.items.every((it) => now >= it.etaUnix);

    if (explicitlyArrived || allPastEta) continue;
    out.push(v);
  }

  // newest first
  out.sort((a, b) => (b.createdAtUnix ?? 0) - (a.createdAtUnix ?? 0));
  return out;
}

export function pipelineBySku(args: {
  ownerAddress: string;
  locationId: string;
  nowUnix?: number;
}) {
  const now = args.nowUnix ?? Math.floor(Date.now() / 1000);
  const open = listOpenIntents({
    ownerAddress: args.ownerAddress,
    locationId: args.locationId,
    nowUnix: now,
  });

  const bySku: Record<string, number> = {};
  for (const intent of open) {
    for (const it of intent.items) {
      // only count items not past eta
      if (now >= it.etaUnix) continue;
      bySku[it.sku] = (bySku[it.sku] ?? 0) + it.units;
    }
  }
  return { bySku, open };
}
