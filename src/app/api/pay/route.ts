export const runtime = "nodejs";

import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      error: "Payment execution not implemented yet",
      hint: "Use POST /api/pay/test to preflight (validate + compute transfers) without on-chain execution.",
    },
    { status: 501 }
  );
}
