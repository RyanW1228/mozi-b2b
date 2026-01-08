// src/app/api/orders/list/route.ts
import { NextResponse } from "next/server";
import { getHubRead, MoziEnv } from "@/lib/server/moziHub";
import { isAddress, keccak256, toUtf8Bytes } from "ethers";

export const runtime = "nodejs";

type HubOrder = {
  orderId: string;
  owner: string;
  supplier: string;
  amount: string;
  executeAfter: number;
  canceled: boolean;
  executed: boolean;
  ref: string; // bytes32 intent id
  restaurantId: string; // bytes32 hashed locationId
};

type Intent = {
  ref: string;
  owner: string;
  restaurantId: string;
  executeAfter: number;
  canceled: boolean;
  executed: boolean;
  approved: boolean;
  items: Array<{
    orderId: string;
    supplier: string;
    amount: string;
    executeAfter: number;
    canceled: boolean;
    executed: boolean;
  }>;
};

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const env = (searchParams.get("env") as MoziEnv) || "testing";
    const owner = searchParams.get("owner"); // optional filter

    const locationId = searchParams.get("locationId"); // optional filter
    const restaurantIdFilter = locationId
      ? keccak256(toUtf8Bytes(locationId))
      : null;

    if (owner && !isAddress(owner)) {
      return NextResponse.json(
        { ok: false, error: "Invalid owner address" },
        { status: 400 }
      );
    }

    const hub = getHubRead(env);

    const nextOrderId = (await (hub as any).nextOrderId()) as bigint;

    // Scan last N for speed (configurable via ?limit=)
    const limitParam = searchParams.get("limit");
    const DEFAULT_LIMIT = 200;
    const MAX_LIMIT = 500;

    const LIMIT = Math.min(
      MAX_LIMIT,
      Math.max(1, Number(limitParam) || DEFAULT_LIMIT)
    );

    const nextNum = Number(nextOrderId);
    const startNum = Math.max(0, nextNum - LIMIT);

    const ids: number[] = [];
    for (let id = startNum; id < nextNum; id++) ids.push(id);

    const orders: HubOrder[] = await Promise.all(
      ids.map(async (id) => {
        const o = await (hub as any).pendingOrders(BigInt(id));
        return {
          orderId: String(id),
          owner: o.owner as string,
          supplier: o.supplier as string,
          amount: (o.amount as bigint).toString(),
          executeAfter: Number(o.executeAfter),
          canceled: Boolean(o.canceled),
          executed: Boolean(o.executed),
          ref: (o.ref as string) ?? "0x",
          restaurantId: (o.restaurantId as string) ?? "0x",
        };
      })
    );

    // Filters
    let filtered = owner
      ? orders.filter((x) => x.owner.toLowerCase() === owner.toLowerCase())
      : orders;

    // newest first (per-order)
    filtered.sort((a, b) => Number(b.orderId) - Number(a.orderId));

    // Group into intents by ref
    const byRef = new Map<string, Omit<Intent, "approved">>();

    for (const o of filtered) {
      const key = (o.ref || "").toLowerCase();
      if (!key || key === "0x") continue;

      const existing = byRef.get(key);
      if (!existing) {
        byRef.set(key, {
          ref: o.ref,
          owner: o.owner,
          restaurantId: o.restaurantId,
          executeAfter: o.executeAfter,
          canceled: o.canceled,
          executed: o.executed,
          items: [
            {
              orderId: o.orderId,
              supplier: o.supplier,
              amount: o.amount,
              executeAfter: o.executeAfter,
              canceled: o.canceled,
              executed: o.executed,
            },
          ],
        });
      } else {
        existing.items.push({
          orderId: o.orderId,
          supplier: o.supplier,
          amount: o.amount,
          executeAfter: o.executeAfter,
          canceled: o.canceled,
          executed: o.executed,
        });

        // intent-level summary
        existing.executeAfter = Math.min(existing.executeAfter, o.executeAfter);
        existing.canceled = existing.canceled || Boolean(o.canceled);
        existing.executed =
          existing.executed && Boolean(o.executed) && !Boolean(o.canceled);
      }
    }

    const rawIntents = Array.from(byRef.values());

    // For each intent, ask chain if approved
    const intents: Intent[] = await Promise.all(
      rawIntents.map(async (i) => {
        let approved = false;
        try {
          approved = Boolean(
            await (hub as any).isIntentApproved(i.owner, i.ref)
          );
        } catch {
          approved = false;
        }
        return { ...i, approved };
      })
    );

    // newest first by max orderId within the intent
    intents.sort((a, b) => {
      const maxA = Math.max(...a.items.map((x) => Number(x.orderId)));
      const maxB = Math.max(...b.items.map((x) => Number(x.orderId)));
      return maxB - maxA;
    });

    return NextResponse.json({
      ok: true,
      nextOrderId: nextOrderId.toString(),
      intents,
    });
  } catch (e: any) {
    const msg = e?.shortMessage || e?.reason || e?.message || String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
