// src/app/api/state/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { PlanInput } from "@/lib/types";
import { getState, setState } from "@/lib/stateStore";

export async function GET() {
  return NextResponse.json(getState());
}

export async function PUT(req: Request) {
  const body = (await req.json()) as PlanInput;
  setState(body);
  return NextResponse.json({ ok: true });
}
