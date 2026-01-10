// src/lib/intentStore.ts
export type MoziEnv = "testing" | "production";

export type IntentItem = {
  sku: string;
  units: number;
  supplierId?: string;
  etaUnix: number; // when we consider it "arrived"
};

export type IntentSnapshot = {
  ref: string; // bytes32 hex string
  env: MoziEnv; // keep env so testing/prod never collide
  ownerAddress: string;
  locationId: string;
  restaurantId: string; // bytes32 hex string
  executeAfterUnix: number; // unix seconds
  createdAtUnix: number;
  items: IntentItem[];
  arrivedAtUnix?: number;
};

// ✅ Different global name so it never collides with any other store type.
declare global {
  // eslint-disable-next-line no-var
  var __moziIntentSnapshots: Map<string, IntentSnapshot> | undefined;
}

function store(): Map<string, IntentSnapshot> {
  if (!global.__moziIntentSnapshots) global.__moziIntentSnapshots = new Map();
  return global.__moziIntentSnapshots;
}

function makeKey(i: IntentSnapshot) {
  return `${i.env}::${i.ownerAddress.toLowerCase()}::${
    i.locationId
  }::${i.ref.toLowerCase()}`;
}

export function upsertIntent(i: IntentSnapshot) {
  store().set(makeKey(i), i);
}

export function listOpenIntents(args: {
  env?: MoziEnv;
  ownerAddress: string;
  locationId: string;
  nowUnix?: number;
}) {
  const now = args.nowUnix ?? Math.floor(Date.now() / 1000);
  const env: MoziEnv = args.env ?? "testing";
  const owner = args.ownerAddress.toLowerCase();
  const loc = args.locationId;

  const out: IntentSnapshot[] = [];
  for (const v of store().values()) {
    if (v.env !== env) continue;
    if (v.ownerAddress.toLowerCase() !== owner) continue;
    if (v.locationId !== loc) continue;

    const explicitlyArrived = typeof v.arrivedAtUnix === "number";
    const allPastEta =
      v.items.length > 0 && v.items.every((it) => now >= it.etaUnix);

    if (explicitlyArrived || allPastEta) continue;
    out.push(v);
  }

  out.sort((a, b) => (b.createdAtUnix ?? 0) - (a.createdAtUnix ?? 0));
  return out;
}

export function pipelineBySku(args: {
  env?: MoziEnv;
  ownerAddress: string;
  locationId: string;
  nowUnix?: number;
}) {
  const now = args.nowUnix ?? Math.floor(Date.now() / 1000);

  const open = listOpenIntents({
    env: args.env ?? "testing",
    ownerAddress: args.ownerAddress,
    locationId: args.locationId,
    nowUnix: now,
  });

  const bySku: Record<string, number> = {};
  for (const intent of open) {
    for (const it of intent.items) {
      if (now >= it.etaUnix) continue;
      bySku[it.sku] = (bySku[it.sku] ?? 0) + it.units;
    }
  }

  return { bySku, open };
}
