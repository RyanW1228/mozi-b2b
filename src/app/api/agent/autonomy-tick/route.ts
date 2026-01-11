// src/app/api/agent/autonomy-tick/route.ts
export const runtime = "nodejs";
export const maxDuration = 90;

import { NextResponse } from "next/server";
import { isAddress, BrowserProvider, Contract } from "ethers";
import { MOZI_TREASURY_HUB_ABI } from "@/lib/abis/moziTreasuryHub";

/**
 * IMPORTANT:
 * - This route is meant to be called by your own UI timer or a cron.
 * - It must NOT require MetaMask signatures.
 * - It is protected by a server secret header.
 */

const HUB_ADDR = process.env.NEXT_PUBLIC_MOZI_TREASURY_HUB_ADDRESS ?? "";
const AGENT_ADDR = process.env.NEXT_PUBLIC_MOZI_AGENT_ADDRESS ?? "";
const TICK_SECRET = process.env.MOZI_AUTONOMY_TICK_SECRET ?? "";
const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL ?? "";

export async function POST(req: Request) {
  try {
    // 1) Secret gate (so only you can call this endpoint)
    const got = req.headers.get("x-mozi-tick-secret") ?? "";
    if (!TICK_SECRET || got !== TICK_SECRET) {
      return NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401 }
      );
    }

    if (!HUB_ADDR || !isAddress(HUB_ADDR)) {
      return NextResponse.json(
        { ok: false, error: "missing/invalid hub address" },
        { status: 400 }
      );
    }
    if (!AGENT_ADDR || !isAddress(AGENT_ADDR)) {
      return NextResponse.json(
        { ok: false, error: "missing/invalid agent address" },
        { status: 400 }
      );
    }
    if (!SEPOLIA_RPC_URL) {
      return NextResponse.json(
        { ok: false, error: "missing SEPOLIA_RPC_URL" },
        { status: 400 }
      );
    }

    const body = await req.json().catch(() => null);
    const env = body?.env === "production" ? "production" : "testing";
    const ownerAddress = String(body?.ownerAddress ?? "");
    const locationId = String(body?.locationId ?? "");

    if (!ownerAddress || !isAddress(ownerAddress)) {
      return NextResponse.json(
        { ok: false, error: "missing/invalid ownerAddress" },
        { status: 400 }
      );
    }
    if (!locationId) {
      return NextResponse.json(
        { ok: false, error: "missing locationId" },
        { status: 400 }
      );
    }

    // 2) Read chain state (Autonomous + agent allowed)
    // Use RPC provider (NOT injected wallet)
    const provider = new BrowserProvider(
      // BrowserProvider expects injected; we can’t use it server-side.
      // So instead: use JsonRpcProvider in ethers v6.
      // ---- FIX: use JsonRpcProvider below ----
      // (keeping this comment so it’s obvious)
      null as any
    );

    // --- correct ethers v6 server provider ---
    const { JsonRpcProvider } = await import("ethers");
    const rpc = new JsonRpcProvider(SEPOLIA_RPC_URL);
    const hub = new Contract(HUB_ADDR, MOZI_TREASURY_HUB_ABI, rpc);

    const [reqApproval, isAllowed] = await Promise.all([
      (hub as any).requireApprovalForExecution(
        ownerAddress
      ) as Promise<boolean>,
      (hub as any).isAgentFor(ownerAddress, AGENT_ADDR) as Promise<boolean>,
    ]);

    if (Boolean(reqApproval)) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "manual_mode_requireApproval=true",
      });
    }

    if (!Boolean(isAllowed)) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "agent_not_allowed_for_owner",
      });
    }

    // 3) Call your existing server propose flow.
    // Option A (recommended): call your internal function (if you have one)
    // Option B (quick): call your existing /api/orders/propose endpoint internally.

    // Quick internal fetch to existing propose route:
    const origin = new URL(req.url).origin;

    const proposeRes = await fetch(
      `${origin}/api/orders/propose?locationId=${encodeURIComponent(
        locationId
      )}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          env,
          ownerAddress,
          pendingWindowHours: 0,
          // keep these defaults or allow passing knobs:
          strategy: body?.strategy ?? "balanced",
          horizonDays: body?.horizonDays ?? 7,
          notes: body?.notes ?? "",
          // NOTE: /api/orders/propose must NOT require MetaMask signature for this to work
        }),
      }
    );

    const proposeJson = await proposeRes.json().catch(() => null);

    if (!proposeRes.ok || !proposeJson?.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "propose_failed",
          status: proposeRes.status,
          proposeJson,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, ran: true, propose: proposeJson });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
