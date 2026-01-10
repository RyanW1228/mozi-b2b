import { NextResponse } from "next/server";
import type { PlanInput } from "@/lib/types";
import { generatePlan } from "@/lib/server/generatePlan";

export async function POST(req: Request) {
  try {
    const input = (await req.json()) as PlanInput;
    const plan = await generatePlan(input);
    return NextResponse.json(plan);
  } catch (err: any) {
    return NextResponse.json(
      { error: "Gemini call failed", detail: String(err?.message ?? err) },
      { status: 502 }
    );
  }
}
