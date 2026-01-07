//src/app/api/orders/list/route.ts

import { NextResponse } from "next/server";
import { getHubRead, MoziEnv } from "@/lib/server/moziHub";
import { isAddress, keccak256, toUtf8Bytes } from "ethers";

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

    // How many orders exist (0..nextOrderId-1)
    const nextOrderId = (await (hub as any).nextOrderId()) as bigint;

    // Scan only last N for speed (avoid BigInt literals for ES2019 compatibility)
    const LIMIT = 50;
    const nextNum = Number(nextOrderId);
    const startNum = Math.max(0, nextNum - LIMIT);

    const ids: number[] = [];
    for (let id = startNum; id < nextNum; id++) ids.push(id);

    const orders = await Promise.all(
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
          ref: o.ref as string,
          restaurantId: o.restaurantId as string,
        };
      })
    );

    let filtered = owner
      ? orders.filter((x) => x.owner.toLowerCase() === owner.toLowerCase())
      : orders;

    if (restaurantIdFilter) {
      filtered = filtered.filter(
        (x) => x.restaurantId.toLowerCase() === restaurantIdFilter.toLowerCase()
      );
    }

    // newest first
    filtered.sort((a, b) => Number(b.orderId) - Number(a.orderId));

    return NextResponse.json({
      ok: true,
      nextOrderId: nextOrderId.toString(),
      orders: filtered,
    });
  } catch (e: any) {
    const msg = e?.shortMessage || e?.reason || e?.message || String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
