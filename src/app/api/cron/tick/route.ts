// src/app/api/cron/tick/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { isAddress } from "ethers";

const DEFAULT_OWNER_ADDRESS = process.env.MOZI_DEFAULT_OWNER_ADDRESS ?? "";
const CRON_LOCATION_IDS = process.env.MOZI_CRON_LOCATION_IDS ?? "";
const CRON_SECRET = process.env.MOZI_CRON_SECRET ?? "";

// If you want cron to set defaults for “control knobs”
const DEFAULT_STRATEGY = process.env.MOZI_DEFAULT_STRATEGY ?? "balanced";
const DEFAULT_HORIZON_DAYS = Number(
  process.env.MOZI_DEFAULT_HORIZON_DAYS ?? "7"
);
const DEFAULT_NOTES = process.env.MOZI_DEFAULT_NOTES ?? "Normal week";
const DEFAULT_PENDING_WINDOW_HOURS = Number(
  process.env.MOZI_DEFAULT_PENDING_WINDOW_HOURS ?? "24"
);

function getParam(url: string, key: string) {
  const u = new URL(url);
  const v = u.searchParams.get(key);
  return v && v.trim().length ? v.trim() : null;
}

function getCronLocationIds(): string[] {
  return CRON_LOCATION_IDS.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function checkCronAuth(req: Request): NextResponse | null {
  if (!CRON_SECRET) return null;

  const sig = req.headers.get("x-mozicronsig");
  const auth = req.headers.get("authorization");
  const bearer =
    auth && auth.toLowerCase().startsWith("bearer ")
      ? auth.slice("bearer ".length).trim()
      : null;

  if (sig !== CRON_SECRET && bearer !== CRON_SECRET) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 }
    );
  }
  return null;
}

export async function GET(req: Request) {
  // Vercel Cron hits GET. We still support GET, using env vars/defaults.
  return run(req);
}

export async function POST(req: Request) {
  // Local/manual triggers can POST JSON for ownerAddress, etc.
  return run(req);
}

async function run(req: Request) {
  try {
    const authFail = checkCronAuth(req);
    if (authFail) return authFail;

    const origin = new URL(req.url).origin;

    const locationIdParam = getParam(req.url, "locationId");
    const locationIds = locationIdParam
      ? [locationIdParam]
      : getCronLocationIds();

    if (locationIds.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Missing locationId and MOZI_CRON_LOCATION_IDS is empty. Provide ?locationId=... or set MOZI_CRON_LOCATION_IDS=loc-1,loc-2",
        },
        { status: 400 }
      );
    }

    // POST body optional; GET has none
    const body = (await req.json().catch(() => ({}))) as {
      env?: "testing" | "production";
      ownerAddress?: string;
      pendingWindowHours?: number;
      strategy?: string;
      horizonDays?: number;
      notes?: string;
    };

    const env = body.env ?? "testing";
    const ownerAddress = body.ownerAddress ?? DEFAULT_OWNER_ADDRESS ?? "";

    if (!ownerAddress || !isAddress(ownerAddress)) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Missing/invalid ownerAddress. Either send JSON body { ownerAddress: '0x...' } OR set MOZI_DEFAULT_OWNER_ADDRESS in env.",
        },
        { status: 400 }
      );
    }

    const results: Array<{
      locationId: string;
      ok: boolean;
      status: number;
      json: any;
    }> = [];

    for (const locationId of locationIds) {
      // Delegate to the ONE source of truth for ordering
      const proposeUrl =
        `${origin}/api/orders/propose?locationId=` +
        encodeURIComponent(locationId);

      const res = await fetch(proposeUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          env,
          ownerAddress,
          pendingWindowHours:
            body.pendingWindowHours ?? DEFAULT_PENDING_WINDOW_HOURS,
          strategy: body.strategy ?? DEFAULT_STRATEGY,
          horizonDays:
            typeof body.horizonDays === "number"
              ? body.horizonDays
              : DEFAULT_HORIZON_DAYS,
          notes: body.notes ?? DEFAULT_NOTES,
        }),
      });

      const json = await res.json().catch(() => null);

      results.push({
        locationId,
        ok: Boolean(json?.ok) && res.ok,
        status: res.status,
        json,
      });
    }

    return NextResponse.json({
      ok: true,
      env,
      ownerAddress,
      results,
      note: "This cron delegates to /api/orders/propose per location (pipeline-aware). If something fails, check that response json for the failing location.",
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
