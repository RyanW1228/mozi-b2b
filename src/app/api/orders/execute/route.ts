// src/app/api/orders/execute/route.ts
export const runtime = "nodejs";
export const maxDuration = 90;

import { NextResponse } from "next/server";
import { isAddress, keccak256, toUtf8Bytes } from "ethers";
import { getHubWrite, MoziEnv } from "@/lib/server/moziHub";

function jsonError(message: string, status: number, detail?: any) {
  return NextResponse.json({ ok: false, error: message, detail }, { status });
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

async function rpc<T>(fn: () => Promise<T>, label: string, attempts = 2) {
  let lastErr: any = null;
  for (let i = 0; i < attempts; i++) {
    try {
      return await withTimeout(fn(), 15_000, label);
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
      await sleep(300 * (i + 1));
    }
  }
  throw lastErr;
}

/**
 * Immediate-pay endpoint (no pending/cancel).
 *
 * POST body:
 * {
 *   env?: "testing" | "production",
 *   ownerAddress: string,
 *   supplierAddress: string,
 *   amount: string | number,     // uint256 (smallest denomination)
 *   ref?: string,                // bytes32 hex
 *   restaurantId?: string,       // bytes32 hex
 *   locationId?: string          // if restaurantId not provided, hash locationId
 * }
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as {
      env?: MoziEnv;
      ownerAddress: string;
      supplierAddress: string;
      amount: string | number;
      ref?: string;
      restaurantId?: string;
      locationId?: string;
    } | null;

    if (!body) return jsonError("Missing JSON body", 400);

    const env: MoziEnv = (body.env as MoziEnv) ?? "testing";

    // Guard: only Sepolia for now
    if (env !== "testing") {
      return jsonError("Broadcast disabled unless env=testing (Sepolia)", 400);
    }

    const owner = body.ownerAddress;
    const supplier = body.supplierAddress;

    if (!owner || !isAddress(owner))
      return jsonError("Invalid ownerAddress", 400);
    if (!supplier || !isAddress(supplier))
      return jsonError("Invalid supplierAddress", 400);

    const amtBig = BigInt(String(body.amount ?? "0"));
    if (amtBig <= BigInt(0)) return jsonError("amount must be > 0", 400);

    const ZERO_REF =
      "0x0000000000000000000000000000000000000000000000000000000000000000";

    const ref =
      typeof body.ref === "string" &&
      body.ref.startsWith("0x") &&
      body.ref.length === 66
        ? body.ref
        : ZERO_REF;

    let restaurantId =
      typeof body.restaurantId === "string" &&
      body.restaurantId.startsWith("0x") &&
      body.restaurantId.length === 66
        ? body.restaurantId
        : ZERO_REF;

    if (
      restaurantId === ZERO_REF &&
      typeof body.locationId === "string" &&
      body.locationId.trim().length > 0
    ) {
      restaurantId = keccak256(toUtf8Bytes(body.locationId.trim()));
    }

    const hubWrite = getHubWrite(env);

    const tx = await rpc(
      () =>
        (hubWrite as any).payOrderFor(
          owner,
          supplier,
          amtBig,
          ref,
          restaurantId
        ),
      "payOrderFor(...)",
      2
    );

    // Wait 1 confirmation for a stable UI receipt
    const receipt = await withTimeout(
      (tx as any).wait(1),
      60_000,
      "tx.wait(1)"
    );

    return NextResponse.json({
      ok: true,
      env,
      ownerAddress: owner,
      supplierAddress: supplier,
      amount: amtBig.toString(),
      ref,
      restaurantId,
      txHash: (tx as any).hash,
      blockNumber: (receipt as any)?.blockNumber ?? null,
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
