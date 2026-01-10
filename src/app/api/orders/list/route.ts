// src/app/api/orders/list/route.ts
import { NextResponse } from "next/server";
import { getHubRead, MoziEnv } from "@/lib/server/moziHub";
import { isAddress, keccak256, toUtf8Bytes } from "ethers";

export const runtime = "nodejs";

// -------------------------
// Burst-proofing: in-flight dedupe + short TTL cache
// Keyed by env+owner+locationId
// -------------------------
type CacheEntry = {
  expiresAtMs: number;
  payload: any;
};

const CACHE_TTL_MS = 2_000;

const inFlight = new Map<string, Promise<any>>();
const cache = new Map<string, CacheEntry>();

function makeKey(env: string, owner: string | null, locationId: string | null) {
  return `${env}|${(owner ?? "").toLowerCase()}|${locationId ?? ""}`;
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

// -------------------------
// Canonical UI intent shape (matches LocationPage types)
// -------------------------
type OrderLine = {
  sku: string;
  name?: string;
  qty: number;
  uom?: string;
};

type IntentItem = {
  orderId: string;
  supplier: string;
  amount: string;
  executeAfter?: number;
  lines: OrderLine[];

  txHash?: string;
  createdAtUnix?: number;
  to?: string;
};

type IntentRow = {
  ref: string; // bytes32
  owner: string;
  restaurantId: string; // bytes32
  executeAfter?: number;
  approved?: boolean;
  executed?: boolean;
  canceled?: boolean;
  items: IntentItem[];
  createdAtUnix?: number; // optional but useful for sorting
  locationId?: string;
  env?: "testing" | "production";
};

// -------------------------
// Option A legacy: Executed-order receipts (tx only)
// -------------------------
type ExecutedOrderReceipt = {
  id: string;
  env: "testing" | "production";
  locationId: string;
  ownerAddress: string;
  ref: string | null;
  restaurantId: string | null;
  txHash: string;
  to: string;
  createdAtUnix: number;
};

declare global {
  // eslint-disable-next-line no-var
  var __moziIntentStore: Map<string, any> | undefined;
  // eslint-disable-next-line no-var
  var __moziExecutedOrders: Map<string, ExecutedOrderReceipt> | undefined;
}

function intentStore(): Map<string, any> {
  if (!global.__moziIntentStore) global.__moziIntentStore = new Map();
  return global.__moziIntentStore;
}

function executedOrdersStore(): Map<string, ExecutedOrderReceipt> {
  if (!global.__moziExecutedOrders) global.__moziExecutedOrders = new Map();
  return global.__moziExecutedOrders;
}

// Coerce “unknown stored value” into IntentRow if it already matches, otherwise null.
function asIntentRowMaybe(v: any): IntentRow | null {
  if (!v || typeof v !== "object") return null;

  // Must have ref + owner + items array (items can be empty but should exist)
  const ref = String(v.ref ?? "");
  const owner = String(v.owner ?? v.ownerAddress ?? "");
  const items = Array.isArray(v.items) ? v.items : null;

  if (!ref || !owner || !items) return null;

  const restaurantId = String(v.restaurantId ?? "0x");

  // Normalize items.lines
  const normItems: IntentItem[] = items.map((it: any, idx: number) => {
    const linesRaw = Array.isArray(it?.lines) ? it.lines : [];
    const lines: OrderLine[] = linesRaw
      .map((ln: any) => ({
        sku: String(ln?.sku ?? ""),
        name: ln?.name ? String(ln.name) : undefined,
        qty: Number(ln?.qty ?? ln?.units ?? 0),
        uom: ln?.uom ? String(ln.uom) : undefined,
      }))
      .filter((ln: any) => ln.sku);

    return {
      orderId: String(it?.orderId ?? `${ref}:${idx}`),
      supplier: String(it?.supplier ?? ""),
      amount: String(it?.amount ?? "0"),
      executeAfter:
        typeof it?.executeAfter === "number" ? it.executeAfter : undefined,
      lines,
      txHash: it?.txHash ? String(it.txHash) : undefined,
      to: it?.to ? String(it.to) : undefined,
      createdAtUnix:
        typeof it?.createdAtUnix === "number" ? it.createdAtUnix : undefined,
    };
  });

  const out: IntentRow = {
    ref,
    owner,
    restaurantId,
    executeAfter:
      typeof v.executeAfter === "number" ? v.executeAfter : undefined,
    approved: typeof v.approved === "boolean" ? v.approved : undefined,
    executed: typeof v.executed === "boolean" ? v.executed : undefined,
    canceled: typeof v.canceled === "boolean" ? v.canceled : undefined,
    items: normItems,
    createdAtUnix:
      typeof v.createdAtUnix === "number" ? v.createdAtUnix : undefined,
    locationId: v.locationId ? String(v.locationId) : undefined,
    env:
      v.env === "production"
        ? "production"
        : v.env === "testing"
        ? "testing"
        : undefined,
  };

  return out;
}

// If we only have receipts, convert them into IntentRow so UI still shows *something*.
function receiptsToIntents(
  receipts: ExecutedOrderReceipt[],
  locationId: string | null
): IntentRow[] {
  const byRef = new Map<string, IntentRow>();

  for (const r of receipts) {
    const restaurantId =
      r.restaurantId ||
      (locationId ? keccak256(toUtf8Bytes(locationId)) : "0x");

    const refLower = String(r.ref ?? "").toLowerCase();
    const groupKey =
      refLower && refLower !== "0x"
        ? refLower
        : `__tx__:${r.txHash.toLowerCase()}`;

    const existing = byRef.get(groupKey);
    if (!existing) {
      byRef.set(groupKey, {
        ref: r.ref && r.ref !== "0x" ? r.ref : "0x",
        owner: r.ownerAddress,
        restaurantId: String(restaurantId),
        approved: false,
        executed: true,
        canceled: false,
        executeAfter: r.createdAtUnix, // best-effort
        createdAtUnix: r.createdAtUnix,
        items: [
          {
            orderId: `${r.ref && r.ref !== "0x" ? r.ref : r.txHash}:0`,
            supplier: "", // unknown in receipts-only
            amount: "0",
            executeAfter: r.createdAtUnix,
            lines: [], // no SKU lines in receipts-only
            txHash: r.txHash,
            to: r.to,
            createdAtUnix: r.createdAtUnix,
          },
        ],
      });
    } else {
      existing.items.push({
        orderId: `${existing.ref}:${existing.items.length}`,
        supplier: "",
        amount: "0",
        executeAfter: r.createdAtUnix,
        lines: [],
        txHash: r.txHash,
        to: r.to,
        createdAtUnix: r.createdAtUnix,
      });
      const t0 = existing.createdAtUnix ?? 0;
      existing.createdAtUnix = Math.max(t0, r.createdAtUnix ?? 0);
    }
  }

  return Array.from(byRef.values());
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const env = (searchParams.get("env") as MoziEnv) || "testing";
    const owner = searchParams.get("owner");
    const locationId = searchParams.get("locationId");

    if (owner && !isAddress(owner))
      return jsonError("Invalid owner address", 400);
    if (!locationId) return jsonError("Missing locationId", 400);

    const key = makeKey(env, owner, locationId);
    const nowMs = Date.now();

    // limit: default 10 (you asked for last 10)
    const limitParam = searchParams.get("limit");
    const DEFAULT_LIMIT = 10;
    const MAX_LIMIT = 50;
    const LIMIT = Math.min(
      MAX_LIMIT,
      Math.max(1, Number(limitParam) || DEFAULT_LIMIT)
    );

    // 1) cache
    const cached = cache.get(key);
    if (cached && cached.expiresAtMs > nowMs) {
      return NextResponse.json(cached.payload);
    }

    // 2) inflight
    const running = inFlight.get(key);
    if (running) {
      const payload = await running;
      return NextResponse.json(payload);
    }

    const restaurantIdFilter = keccak256(toUtf8Bytes(locationId)).toLowerCase();

    const workPromise = (async () => {
      // Preferred source: full intents written by /api/orders/propose
      // You said you already write to global.__moziIntentStore keyed by `${env}:${owner}:${locationId}:${ref}`
      const allStored = Array.from(intentStore().values())
        .map(asIntentRowMaybe)
        .filter(Boolean) as IntentRow[];

      // filter env/owner/location/restaurantId
      let intents = allStored.filter((i) => (i.env ?? env) === env);

      if (owner) {
        const o = owner.toLowerCase();
        intents = intents.filter(
          (i) => String(i.owner ?? "").toLowerCase() === o
        );
      }

      intents = intents.filter(
        (i) => String(i.locationId ?? locationId) === locationId
      );
      intents = intents.filter(
        (i) => String(i.restaurantId ?? "").toLowerCase() === restaurantIdFilter
      );

      // Fallback: if we have no intents stored, use receipt store so UI still shows something.
      if (intents.length === 0) {
        const allReceipts = Array.from(executedOrdersStore().values());
        let filtered = allReceipts.filter((r) => r.env === env);

        if (owner) {
          const o = owner.toLowerCase();
          filtered = filtered.filter((r) => r.ownerAddress.toLowerCase() === o);
        }

        filtered = filtered.filter((r) => r.locationId === locationId);

        // restaurantId filter if present
        filtered = filtered.filter(
          (r) =>
            !r.restaurantId ||
            String(r.restaurantId).toLowerCase() === restaurantIdFilter
        );

        intents = receiptsToIntents(filtered, locationId);
      }

      // Optional: fill approved flag from chain when ref is real
      const hub = getHubRead(env);

      intents = await Promise.all(
        intents.map(async (i) => {
          let approved = Boolean(i.approved ?? false);
          try {
            if (i.ref && i.ref !== "0x") {
              approved = Boolean(
                await (hub as any).isIntentApproved(i.owner, i.ref)
              );
            }
          } catch {
            // keep best-effort
          }
          return { ...i, approved };
        })
      );

      // Sort newest-first: prefer createdAtUnix, else first item's createdAtUnix, else executeAfter
      intents.sort((a, b) => {
        const ta =
          Number(a.createdAtUnix ?? 0) ||
          Number(a.items?.[0]?.createdAtUnix ?? 0) ||
          Number(a.executeAfter ?? 0);
        const tb =
          Number(b.createdAtUnix ?? 0) ||
          Number(b.items?.[0]?.createdAtUnix ?? 0) ||
          Number(b.executeAfter ?? 0);
        return tb - ta;
      });

      const intentsLimited = intents.slice(0, LIMIT);

      return {
        ok: true,
        intents: intentsLimited,
        cachedAtMs: Date.now(),
        cacheTtlMs: CACHE_TTL_MS,
        source:
          allStored.length > 0
            ? "backend_intents"
            : "backend_receipts_fallback",
        limit: LIMIT,
      };
    })();

    inFlight.set(key, workPromise);

    try {
      const payload = await workPromise;
      cache.set(key, { expiresAtMs: Date.now() + CACHE_TTL_MS, payload });
      return NextResponse.json(payload);
    } finally {
      inFlight.delete(key);
    }
  } catch (e: any) {
    const msg = e?.shortMessage || e?.reason || e?.message || String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
