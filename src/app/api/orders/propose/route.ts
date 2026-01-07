// src/app/api/orders/propose/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import {
  isAddress,
  JsonRpcProvider,
  Wallet,
  keccak256,
  toUtf8Bytes,
} from "ethers";
import { upsertIntent } from "@/lib/intentStore";

type ExecuteCall = { to: string; data: string };

function getLocationIdFromUrl(url: string): string | null {
  const u = new URL(url);
  const locationId = u.searchParams.get("locationId");
  return locationId && locationId.trim().length > 0 ? locationId : null;
}

export async function POST(req: Request) {
  try {
    const locationId = getLocationIdFromUrl(req.url);
    if (!locationId) {
      return NextResponse.json(
        { ok: false, error: "Missing locationId in query string" },
        { status: 400 }
      );
    }

    const body = (await req.json()) as {
      env?: "testing" | "production";
      ownerAddress: string;
      pendingWindowHours?: number;

      // optional “control knobs” so periodic proposer matches your UI settings
      strategy?: string;
      horizonDays?: number;
      notes?: string;
    };

    const env = body.env ?? "testing";
    const ownerAddress = body.ownerAddress;

    if (!ownerAddress || !isAddress(ownerAddress)) {
      return NextResponse.json(
        { ok: false, error: "Invalid ownerAddress" },
        { status: 400 }
      );
    }

    // ✅ Guard: only Sepolia for now
    if (env !== "testing") {
      return NextResponse.json(
        { ok: false, error: "Broadcast disabled unless env=testing (Sepolia)" },
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

    // -------------------------
    // Step 4: refresh intentStore from chain BEFORE building state/plan
    // -------------------------
    const origin = new URL(req.url).origin;

    const warmRes = await fetch(
      `${origin}/api/orders/list?env=${encodeURIComponent(env)}` +
        `&owner=${encodeURIComponent(ownerAddress)}` +
        `&locationId=${encodeURIComponent(locationId)}`,
      { method: "GET" }
    );

    // optional debug only
    const warmJson = await warmRes.json().catch(() => null);

    // Now fetch deterministic state (pipeline-aware)
    const stateRes = await fetch(
      `${origin}/api/state?locationId=${encodeURIComponent(locationId)}` +
        `&owner=${encodeURIComponent(ownerAddress)}`,
      { method: "GET" }
    );

    const baseInput = await stateRes.json().catch(() => null);

    if (!stateRes.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "State route failed",
          detail: baseInput,
          warmup: { ok: warmRes.ok, status: warmRes.status, json: warmJson },
        },
        { status: stateRes.status }
      );
    }

    if (!baseInput) {
      return NextResponse.json(
        {
          ok: false,
          error: "State route returned empty JSON",
          warmup: warmJson,
        },
        { status: 500 }
      );
    }

    // 2) Apply “control knobs” (same as UI)
    const input = {
      ...baseInput,
      restaurant: {
        ...(baseInput.restaurant ?? {}),
        id: locationId,
        planningHorizonDays:
          typeof body.horizonDays === "number"
            ? body.horizonDays
            : baseInput.restaurant?.planningHorizonDays ?? 7,
      },
      ownerPrefs: {
        ...(baseInput.ownerPrefs ?? {}),
        strategy: body.strategy ?? baseInput.ownerPrefs?.strategy ?? "balanced",
      },
      context: {
        ...(baseInput.context ?? {}),
        notes: body.notes ?? baseInput.context?.notes ?? "Normal week",
      },
    };

    // 3) Generate plan
    const planRes = await fetch(`${origin}/api/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const plan = await planRes.json();
    if (!planRes.ok) {
      return NextResponse.json(
        { ok: false, error: "Plan route failed", detail: plan },
        { status: planRes.status }
      );
    }

    if (!plan || !Array.isArray(plan?.orders)) {
      return NextResponse.json(
        {
          ok: false,
          error: "Invalid plan shape: plan.orders must be an array",
        },
        { status: 500 }
      );
    }

    // -----------------------------
    // STEP 5: Idempotency guard (don't re-propose inbound SKUs)
    // -----------------------------
    const horizonDays =
      typeof input?.restaurant?.planningHorizonDays === "number"
        ? input.restaurant.planningHorizonDays
        : 7;

    const horizonEndUnix =
      Math.floor(Date.now() / 1000) + Math.max(1, horizonDays) * 86400;

    // pipeline is attached by /api/state (and warmed by /api/orders/list above)
    const pipeline = (baseInput?.context?.pipeline ?? {}) as any;

    // Two possible shapes you’ve seen in logs:
    // (A) pipeline.bySku is flat record
    // (B) pipeline.bySku.bySku exists (older debug nesting)
    const bySkuFlat: Record<string, number> =
      pipeline?.bySku &&
      typeof pipeline.bySku === "object" &&
      !Array.isArray(pipeline.bySku)
        ? pipeline.bySku.bySku ?? pipeline.bySku
        : {};

    // Also use open intents with ETA if available (more correct than flat counts)
    const open = Array.isArray(pipeline?.open) ? pipeline.open : [];

    // Build a set of SKUs that are "inbound soon enough to matter"
    const inboundSoon = new Set<string>();

    // If we have open intents with items + etaUnix, use those
    for (const intent of open) {
      for (const it of intent?.items ?? []) {
        const sku = String(it?.sku ?? "");
        if (!sku) continue;

        const etaUnix = Number(it?.etaUnix ?? 0);
        // If ETA missing, treat as inbound soon (safe)
        if (!etaUnix || etaUnix <= horizonEndUnix) inboundSoon.add(sku);
      }
    }

    // Fallback: if open intents missing, rely on flat bySku counts
    if (inboundSoon.size === 0) {
      for (const sku of Object.keys(bySkuFlat ?? {})) {
        if (Number(bySkuFlat[sku] ?? 0) > 0) inboundSoon.add(sku);
      }
    }

    // Filter plan items that are already inbound soon.
    // (If you prefer to hard-fail instead, I’ll show that below.)
    const filteredOrders = (plan.orders ?? [])
      .map((o: any) => ({
        ...o,
        items: (o.items ?? []).filter((it: any) => {
          const sku = String(it?.sku ?? "");
          return sku && !inboundSoon.has(sku);
        }),
      }))
      .filter((o: any) => (o.items ?? []).length > 0);

    const removedCount =
      (plan.orders ?? []).reduce(
        (acc: number, o: any) => acc + (o.items?.length ?? 0),
        0
      ) -
      filteredOrders.reduce(
        (acc: number, o: any) => acc + (o.items?.length ?? 0),
        0
      );

    plan.orders = filteredOrders;

    // If everything got filtered out, there’s nothing new to propose
    if ((plan.orders ?? []).length === 0) {
      return NextResponse.json(
        {
          ok: true,
          env,
          locationId,
          ownerAddress,
          note: "Nothing to propose (all suggested items already inbound within horizon).",
          removedCount,
          inboundSoon: Array.from(inboundSoon),
        },
        { status: 200 }
      );
    }

    // 4) Ask /api/execute to build encoded calls
    const executeUrl =
      `${origin}/api/execute?locationId=` + encodeURIComponent(locationId);

    const execRes = await fetch(executeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ownerAddress,
        pendingWindowHours: body.pendingWindowHours ?? 24,
        input,
        plan,
      }),
    });

    const execJson = await execRes.json();

    if (!execRes.ok) {
      return NextResponse.json(
        { ok: false, error: "Execute route failed", detail: execJson },
        { status: execRes.status }
      );
    }

    const calls = (execJson?.calls ?? []) as ExecuteCall[];

    if (!Array.isArray(calls) || calls.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No calls produced (nothing to propose)" },
        { status: 400 }
      );
    }

    // -----------------------------
    // ✅ STEP 2: Intent snapshot write
    // -----------------------------
    // This is what lets /api/state account for "already ordered but not arrived".
    try {
      const nowUnix = Math.floor(Date.now() / 1000);
      const pendingWindowHours = body.pendingWindowHours ?? 24;

      // Prefer ref from execute (best), else fall back to deterministic hash
      const refFromExec =
        execJson?.ref || execJson?.intentRef || execJson?.paymentIntent?.ref;

      const ref =
        typeof refFromExec === "string" &&
        refFromExec.startsWith("0x") &&
        refFromExec.length === 66
          ? refFromExec
          : keccak256(toUtf8Bytes(`${ownerAddress}|${locationId}|${nowUnix}`));

      const restaurantId = keccak256(toUtf8Bytes(locationId));
      const executeAfterUnix = nowUnix + pendingWindowHours * 3600;

      // ETA heuristic v1:
      // If you have supplier leadTimeDays in input, we can do better later.
      // ETA using supplier lead time (best-effort)
      // default 1 day if unknown
      const supplierLeadDays = new Map<string, number>(
        (input?.suppliers ?? []).map((s: any) => [
          String(s.supplierId),
          Number(s.leadTimeDays ?? 1),
        ])
      );

      const skuToSupplier = new Map<string, string>(
        (input?.skus ?? []).map((s: any) => [
          String(s.sku),
          String(s.supplierId),
        ])
      );

      function etaForSku(sku: string, fallbackSupplierId?: string) {
        const sup = fallbackSupplierId || skuToSupplier.get(sku) || "";
        const lead = supplierLeadDays.get(sup);
        const leadDays = Number.isFinite(lead as any) ? Number(lead) : 1;
        return executeAfterUnix + Math.max(0, leadDays) * 86400;
      }

      const items: Array<{
        sku: string;
        units: number;
        supplierId?: string;
        etaUnix: number;
      }> = [];

      for (const ord of plan.orders ?? []) {
        const supplierId = ord.supplierId;
        for (const it of ord.items ?? []) {
          const sku = String(it.sku ?? "");
          const units = Number(it.orderUnits ?? 0);
          if (!sku || !Number.isFinite(units) || units <= 0) continue;
          items.push({
            sku,
            units,
            supplierId,
            etaUnix: etaForSku(sku, supplierId),
          });
        }
      }

      upsertIntent({
        ref,
        ownerAddress,
        locationId,
        restaurantId,
        executeAfterUnix,
        createdAtUnix: nowUnix,
        items,
      });
    } catch {
      // MVP: snapshot failure should not block proposing
    }

    // 5) Broadcast calls as agent wallet
    const provider = new JsonRpcProvider(SEPOLIA_RPC_URL);
    const agent = new Wallet(AGENT_PRIVATE_KEY, provider);

    const txs: { to: string; hash: string }[] = [];

    for (const c of calls) {
      if (!c?.to || !isAddress(c.to) || !c?.data) {
        return NextResponse.json(
          { ok: false, error: "Malformed call in calls[]", badCall: c },
          { status: 500 }
        );
      }

      const tx = await agent.sendTransaction({ to: c.to, data: c.data });
      txs.push({ to: c.to, hash: tx.hash });
      await tx.wait();
    }

    return NextResponse.json({
      ok: true,
      env,
      locationId,
      ownerAddress,
      agentAddress: agent.address,
      ref: execJson?.ref || execJson?.intentRef || execJson?.paymentIntent?.ref,
      txs,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
