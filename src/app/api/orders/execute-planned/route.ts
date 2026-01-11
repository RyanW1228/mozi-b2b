// src/app/api/orders/execute-planned/route.ts
export const runtime = "nodejs";
export const maxDuration = 90;

import { NextResponse } from "next/server";
import { isAddress, JsonRpcProvider, Wallet } from "ethers";

import { upsertIntent } from "@/lib/intentStore";
import { getState } from "@/lib/stateStore";
import type { IntentRow } from "@/lib/types/intentRow";

type ExecuteCall = { to: string; data: string };

type OrderLine = { sku: string; name?: string; qty: number; uom?: string };

type IntentItem = {
  orderId: string;
  supplier: string;
  amount: string;
  executeAfter?: number;
  lines: OrderLine[];
  txHash?: string;
  to?: string;
  createdAtUnix?: number;
};

function intentStore(): Map<string, IntentRow> {
  if (!global.__moziIntentStore) global.__moziIntentStore = new Map();
  return global.__moziIntentStore;
}

function normalizeUom(v: any): string | undefined {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s : undefined;
}

function pickSupplierPayoutById(input: any): Map<string, string> {
  const m = new Map<string, string>();
  const sups = Array.isArray(input?.suppliers) ? input.suppliers : [];
  for (const s of sups) {
    const sid = String(s?.supplierId ?? "");
    const payout = String(s?.payoutAddress ?? "");
    if (sid && payout) m.set(sid, payout);
  }
  return m;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
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

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      env?: "testing" | "production";
      ownerAddress: string;
      locationId: string;

      // from /api/orders/plan
      ref: string;
      restaurantId: string;
      plan: any;
      calls: ExecuteCall[];
    };

    const env = body.env ?? "testing";
    const ownerAddress = body.ownerAddress;
    const locationId = String(body.locationId ?? "");
    const ref = String(body.ref ?? "");
    const restaurantId = String(body.restaurantId ?? "");

    if (env !== "testing") {
      return NextResponse.json(
        { ok: false, error: "Broadcast disabled unless env=testing (Sepolia)" },
        { status: 400 }
      );
    }

    if (!ownerAddress || !isAddress(ownerAddress)) {
      return NextResponse.json(
        { ok: false, error: "Invalid ownerAddress" },
        { status: 400 }
      );
    }
    if (!locationId) {
      return NextResponse.json(
        { ok: false, error: "Missing locationId" },
        { status: 400 }
      );
    }
    if (!ref || !ref.startsWith("0x") || ref.length !== 66) {
      return NextResponse.json(
        { ok: false, error: "Invalid ref" },
        { status: 400 }
      );
    }
    if (
      !restaurantId ||
      !restaurantId.startsWith("0x") ||
      restaurantId.length !== 66
    ) {
      return NextResponse.json(
        { ok: false, error: "Invalid restaurantId" },
        { status: 400 }
      );
    }

    const calls = Array.isArray(body.calls) ? body.calls : [];
    if (calls.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Missing calls[]" },
        { status: 400 }
      );
    }

    const AGENT_PRIVATE_KEY = process.env.MOZI_AGENT_PRIVATE_KEY ?? "";
    const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL ?? "";

    if (!AGENT_PRIVATE_KEY) {
      return NextResponse.json(
        { ok: false, error: "Missing MOZI_AGENT_PRIVATE_KEY (server env)" },
        { status: 500 }
      );
    }
    if (!SEPOLIA_RPC_URL) {
      return NextResponse.json(
        { ok: false, error: "Missing SEPOLIA_RPC_URL (server env)" },
        { status: 500 }
      );
    }

    // Broadcast as agent wallet
    const provider = new JsonRpcProvider(SEPOLIA_RPC_URL);
    const agent = new Wallet(AGENT_PRIVATE_KEY, provider);

    const txs: { to: string; hash: string }[] = [];
    const createdAtUnix = Math.floor(Date.now() / 1000);

    const fee = await provider.getFeeData();
    let nextNonce = await provider.getTransactionCount(
      agent.address,
      "pending"
    );

    function bump(big: bigint | null | undefined, pct: number) {
      if (!big) return null;
      return (big * BigInt(100 + pct)) / BigInt(100);
    }

    const bumpedMaxFee = bump(fee.maxFeePerGas ?? null, 30);
    const bumpedMaxPrio = bump(fee.maxPriorityFeePerGas ?? null, 30);
    const bumpedGasPrice = bump(fee.gasPrice ?? null, 30);

    for (const c of calls) {
      if (!c?.to || !isAddress(c.to) || !c?.data) {
        return NextResponse.json(
          { ok: false, error: "Malformed call in calls[]", badCall: c },
          { status: 500 }
        );
      }

      const txRequest: any = { to: c.to, data: c.data, nonce: nextNonce++ };

      if (bumpedMaxFee && bumpedMaxPrio) {
        txRequest.maxFeePerGas = bumpedMaxFee;
        txRequest.maxPriorityFeePerGas = bumpedMaxPrio;
      } else if (bumpedGasPrice) {
        txRequest.gasPrice = bumpedGasPrice;
      }

      const tx = await withTimeout(
        agent.sendTransaction(txRequest),
        20_000,
        "sendTransaction"
      );
      txs.push({ to: c.to, hash: tx.hash });
    }

    // Write receipts to __moziIntentStore (same idea as /propose)
    const input = getState(locationId);
    const payoutBySupplierId = pickSupplierPayoutById(input);
    const planOrders = Array.isArray(body.plan?.orders) ? body.plan.orders : [];

    const items: IntentItem[] = planOrders.map((o: any, idx: number) => {
      const supplierId = String(o?.supplierId ?? "");
      const supplierPayout =
        String(o?.supplierAddress ?? "") ||
        String(o?.payoutAddress ?? "") ||
        (supplierId ? payoutBySupplierId.get(supplierId) ?? "" : "");

      const rawAmount =
        String(o?.amount ?? "") ||
        String(o?.amountRaw ?? "") ||
        String(o?.totalAmount ?? "") ||
        String(o?.totalAmountRaw ?? "") ||
        "0";

      const lines: OrderLine[] = Array.isArray(o?.items)
        ? (o.items
            .map((it: any) => {
              const sku = String(it?.sku ?? "");
              const name = it?.name ? String(it.name) : undefined;

              const qtyNum = Number(
                it?.qty ?? it?.quantity ?? it?.orderUnits ?? 0
              );
              const qty = Number.isFinite(qtyNum) ? qtyNum : 0;

              const uom = normalizeUom(it?.uom);

              if (!sku || qty <= 0) return null;
              return { sku, name, qty, uom };
            })
            .filter(Boolean) as OrderLine[])
        : [];

      const txHit = txs[idx];

      return {
        orderId: String(o?.orderId ?? `${ref}:${idx}`),
        supplier: supplierPayout,
        amount: rawAmount,
        executeAfter: createdAtUnix,
        lines,
        txHash: txHit?.hash,
        to: txHit?.to,
        createdAtUnix,
      };
    });

    const intentRow: IntentRow = {
      ref,
      owner: ownerAddress,
      restaurantId,
      locationId,
      executeAfter: createdAtUnix,
      approved: true,
      executed: true,
      canceled: false,
      items: items.filter(
        (it) => Array.isArray(it.lines) && it.lines.length > 0
      ),
      createdAtUnix,
      env,
    };

    const storeKey = `${env}:${ownerAddress.toLowerCase()}:${locationId}:${ref.toLowerCase()}`;
    intentStore().set(storeKey, intentRow);

    // Optional: also upsert pipeline snapshot (best-effort)
    try {
      const nowUnix = createdAtUnix;

      const supplierLeadDays = new Map<string, number>(
        (input?.suppliers ?? []).map((s: any) => [
          String(s?.supplierId ?? ""),
          Number(s?.leadTimeDays ?? 1),
        ])
      );

      const skuToSupplier = new Map<string, string>(
        (input?.skus ?? []).map((s: any) => [
          String(s?.sku ?? ""),
          String(s?.supplierId ?? ""),
        ])
      );

      function etaForSku(sku: string, fallbackSupplierId?: string) {
        const sup = fallbackSupplierId || skuToSupplier.get(sku) || "";
        const lead = supplierLeadDays.get(sup);
        const leadDays = Number.isFinite(lead as any) ? Number(lead) : 1;
        return nowUnix + Math.max(0, leadDays) * 86400;
      }

      const snapItems: Array<{
        sku: string;
        units: number;
        supplierId?: string;
        etaUnix: number;
      }> = [];

      for (const ord of planOrders) {
        const supplierId = String(ord?.supplierId ?? "");
        for (const it of ord?.items ?? []) {
          const sku = String(it?.sku ?? "");
          const units = Number(it?.orderUnits ?? it?.qty ?? it?.quantity ?? 0);
          if (!sku || !Number.isFinite(units) || units <= 0) continue;

          snapItems.push({
            sku,
            units,
            supplierId: supplierId || undefined,
            etaUnix: etaForSku(sku, supplierId),
          });
        }
      }

      upsertIntent({
        ref,
        env,
        ownerAddress,
        locationId,
        restaurantId,
        executeAfterUnix: nowUnix,
        createdAtUnix: nowUnix,
        items: snapItems,
      });
    } catch {
      // best-effort
    }

    return NextResponse.json({
      ok: true,
      env,
      locationId,
      ownerAddress,
      agentAddress: agent.address,
      ref,
      txs,
      intent: intentRow,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
