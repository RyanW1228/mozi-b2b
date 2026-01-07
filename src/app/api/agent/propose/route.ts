export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { isAddress, JsonRpcProvider, Wallet, Contract } from "ethers";

// We only need "to" + "data" from your /api/execute response
type ExecuteCall = {
  to: string;
  data: string;
  supplierId?: string;
  amountUsd?: number;
};

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
    };

    const env = body.env ?? "testing";
    const ownerAddress = body.ownerAddress;

    if (!ownerAddress || !isAddress(ownerAddress)) {
      return NextResponse.json(
        { ok: false, error: "Invalid ownerAddress" },
        { status: 400 }
      );
    }

    // ✅ HARD GUARD: only allow Sepolia for now
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

    // 1) Ask your existing execute route to build the calls
    const executeUrl =
      `${new URL(req.url).origin}/api/execute?locationId=` +
      encodeURIComponent(locationId);

    const execRes = await fetch(executeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ownerAddress,
        pendingWindowHours: body.pendingWindowHours ?? 24,
        // IMPORTANT: your /api/execute ignores client input and uses getState(locationId)
        // so we don't need to send input/plan/paymentIntent from here.
        plan: { orders: [] }, // placeholder only if your route requires it; remove if not needed
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
    const hub = execJson?.hub as string;

    if (!hub || !isAddress(hub)) {
      return NextResponse.json(
        { ok: false, error: "Bad hub address returned from /api/execute" },
        { status: 500 }
      );
    }

    if (!Array.isArray(calls) || calls.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No calls produced (nothing to propose)" },
        { status: 400 }
      );
    }

    // 2) Broadcast the calls as the agent wallet
    const provider = new JsonRpcProvider(SEPOLIA_RPC_URL);
    const agent = new Wallet(AGENT_PRIVATE_KEY, provider);

    // Sending raw calldata: easiest via wallet.sendTransaction({to, data})
    // (No value, hub method is non-payable.)
    const txs: { to: string; hash: string }[] = [];
    for (const c of calls) {
      if (!c?.to || !isAddress(c.to) || !c?.data) {
        return NextResponse.json(
          { ok: false, error: "Malformed call in calls[]", badCall: c },
          { status: 500 }
        );
      }

      const tx = await agent.sendTransaction({
        to: c.to,
        data: c.data,
      });

      txs.push({ to: c.to, hash: tx.hash });
      await tx.wait();
    }

    return NextResponse.json({
      ok: true,
      env,
      locationId,
      ownerAddress,
      agentAddress: agent.address,
      txs,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
