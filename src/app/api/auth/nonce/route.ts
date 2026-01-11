// src/app/api/auth/nonce/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { isAddress } from "ethers";

// In-memory nonce store (MVP)
declare global {
  // eslint-disable-next-line no-var
  var __moziNonceStore:
    | Map<string, { nonce: string; issuedAtMs: number }>
    | undefined;
}

function nonceStore() {
  if (!global.__moziNonceStore) global.__moziNonceStore = new Map();
  return global.__moziNonceStore;
}

function nonceKey(env: string, owner: string, locationId: string) {
  return `${env}:${owner.toLowerCase()}:${locationId}`;
}

export async function GET(req: Request) {
  const url = new URL(req.url);

  const envRaw = (url.searchParams.get("env") ?? "testing").toLowerCase();
  const env = envRaw === "production" ? "production" : "testing";

  const owner = String(url.searchParams.get("owner") ?? "");
  const locationId = String(url.searchParams.get("locationId") ?? "");

  if (!owner || !isAddress(owner)) {
    return NextResponse.json(
      { ok: false, error: "invalid owner" },
      { status: 400 }
    );
  }
  if (!locationId) {
    return NextResponse.json(
      { ok: false, error: "missing locationId" },
      { status: 400 }
    );
  }

  const nonce = `mozi_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const issuedAtMs = Date.now();

  nonceStore().set(nonceKey(env, owner, locationId), { nonce, issuedAtMs });

  return NextResponse.json({
    ok: true,
    env,
    owner,
    locationId,
    nonce,
    issuedAtMs,
  });
}
