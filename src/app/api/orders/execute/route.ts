// src/app/api/orders/execute/route.ts
export const runtime = "nodejs";
export const maxDuration = 90;

import { NextResponse } from "next/server";
import { keccak256, toUtf8Bytes, isAddress } from "ethers";
import { getHubRead, getHubWrite, MoziEnv } from "@/lib/server/moziHub";

// Ethers v6 returns tuple-like arrays for ABI "returns (...)"
type PendingOrderTuple = readonly [
  owner: string,
  supplier: string,
  amount: bigint,
  executeAfter: bigint, // uint64 -> bigint in ethers v6
  canceled: boolean,
  executed: boolean,
  ref: string,
  restaurantId: string
];

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms
    );
    p.then((v) => {
      clearTimeout(id);
      resolve(v);
    }).catch((e) => {
      clearTimeout(id);
      reject(e);
    });
  });
}

async function rpc<T>(fn: () => Promise<T>, label: string, attempts = 3) {
  let lastErr: any = null;
  for (let i = 0; i < attempts; i++) {
    try {
      return await withTimeout(fn(), 10_000, label);
    } catch (e: any) {
      lastErr = e;
      const msg = String(e?.shortMessage || e?.reason || e?.message || e);

      const retryable =
        msg.includes("missing response for request") ||
        msg.includes("timeout") ||
        msg.includes("ETIMEDOUT") ||
        msg.includes("ECONNRESET") ||
        msg.includes("503") ||
        msg.includes("429");

      if (!retryable || i === attempts - 1) throw e;

      await sleep(250 * (i + 1));
    }
  }
  throw lastErr;
}

export async function POST(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const env = (searchParams.get("env") as MoziEnv) || "testing";
    const owner = searchParams.get("owner"); // optional filter
    const locationId = searchParams.get("locationId"); // optional filter
    const limit = Math.min(
      200,
      Math.max(1, Number(searchParams.get("limit") || 30))
    );

    if (owner && !isAddress(owner)) return jsonError("Invalid owner", 400);

    const hubRead = getHubRead(env);
    const hubWrite = getHubWrite(env);

    const nowUnix = Math.floor(Date.now() / 1000);
    const restaurantIdFilter = locationId
      ? keccak256(toUtf8Bytes(locationId))
      : null;

    const nextOrderId = (await rpc(
      () => (hubRead as any).nextOrderId(),
      "nextOrderId()"
    )) as bigint;

    const nextNum = Number(nextOrderId);

    // Scan newest -> older, but stop early if we keep seeing not-ready orders
    const MAX_NOT_READY_STREAK = 25;

    // caches for manual gating checks
    const requireApprovalCache = new Map<string, boolean>(); // ownerLower -> bool
    const approvedCache = new Map<string, boolean>(); // ownerLower|refLower -> bool

    const readyIds: bigint[] = [];
    let notReadyStreak = 0;

    // newest first
    for (let id = nextNum - 1; id >= 0 && readyIds.length < limit; id--) {
      const tup = (await rpc(
        () => (hubRead as any).pendingOrders(BigInt(id)),
        `pendingOrders(${id})`
      )) as PendingOrderTuple;

      const [
        oOwner,
        _supplier,
        _amount,
        oExecuteAfter,
        oCanceled,
        oExecuted,
        oRef,
        oRestaurantId,
      ] = tup;

      if (!oOwner) continue;
      if (owner && oOwner.toLowerCase() !== owner.toLowerCase()) continue;

      if (
        restaurantIdFilter &&
        String(oRestaurantId || "").toLowerCase() !==
          restaurantIdFilter.toLowerCase()
      ) {
        continue;
      }

      if (oCanceled || oExecuted) continue;

      const executeAfter = Number(oExecuteAfter);
      if (!executeAfter || executeAfter > nowUnix) {
        notReadyStreak++;
        if (notReadyStreak >= MAX_NOT_READY_STREAK) break;
        continue;
      }

      // found a ready one
      notReadyStreak = 0;

      // Manual gating (only if your hub enforces it)
      const ref = String(oRef || "");
      if (ref && ref !== "0x") {
        const ownerKey = oOwner.toLowerCase();

        let reqApproval = requireApprovalCache.get(ownerKey);
        if (reqApproval === undefined) {
          reqApproval = Boolean(
            await rpc(
              () => (hubRead as any).requireApprovalForExecution(oOwner),
              `requireApprovalForExecution(${oOwner})`
            )
          );
          requireApprovalCache.set(ownerKey, reqApproval);
        }

        if (reqApproval) {
          const k = `${ownerKey}|${ref.toLowerCase()}`;
          let approved = approvedCache.get(k);
          if (approved === undefined) {
            approved = Boolean(
              await rpc(
                () => (hubRead as any).isIntentApproved(oOwner, ref),
                `isIntentApproved(${oOwner}, ${ref})`
              )
            );
            approvedCache.set(k, approved);
          }
          if (!approved) continue;
        }
      }

      readyIds.push(BigInt(id));
    }

    if (readyIds.length === 0) {
      return NextResponse.json({
        ok: true,
        ready: 0,
        executed: 0,
        message: "No ready orders.",
      });
    }

    const executedIds: string[] = [];
    const failed: Array<{ orderId: string; error: string }> = [];

    for (const orderId of readyIds) {
      try {
        const tx = await rpc(
          () => (hubWrite as any).executeOrder(orderId),
          `executeOrder(${orderId.toString()})`,
          2
        );

        // Wait 1 confirmation (timeout to avoid hanging forever)
        await withTimeout(
          (tx as any).wait(1),
          60_000,
          `tx.wait(${orderId.toString()})`
        );

        executedIds.push(orderId.toString());
      } catch (e: any) {
        failed.push({
          orderId: orderId.toString(),
          error: String(e?.shortMessage || e?.reason || e?.message || e),
        });
      }
    }

    return NextResponse.json({
      ok: true,
      ready: readyIds.length,
      executed: executedIds.length,
      executedIds,
      failed,
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        error: String(e?.shortMessage || e?.reason || e?.message || e),
      },
      { status: 500 }
    );
  }
}
