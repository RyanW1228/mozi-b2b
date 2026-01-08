//src/app/api/plan/route.ts

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import type { PlanInput, PlanOutput } from "@/lib/types";

export async function POST(req: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing GEMINI_API_KEY" },
        { status: 500 }
      );
    }

    // 1) Read typed input
    const input = (await req.json()) as PlanInput;

    // Basic runtime validation (prevents undefined.map crashes)
    if (
      !input ||
      !input.restaurant ||
      typeof input.restaurant.planningHorizonDays !== "number" ||
      typeof input.restaurant.timezone !== "string" ||
      !Array.isArray(input.skus) ||
      !Array.isArray(input.suppliers)
    ) {
      return NextResponse.json(
        {
          error: "Invalid PlanInput: missing skus or suppliers arrays",
          got: {
            hasInput: Boolean(input),
            skusType: typeof (input as any)?.skus,
            suppliersType: typeof (input as any)?.suppliers,
          },
        },
        { status: 400 }
      );
    }

    // Compute today's date in the restaurant timezone (YYYY-MM-DD)
    function todayISODateInTZ(timeZone: string) {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(new Date());

      const y = parts.find((p) => p.type === "year")?.value;
      const m = parts.find((p) => p.type === "month")?.value;
      const d = parts.find((p) => p.type === "day")?.value;

      // Fallback (shouldn't happen, but keeps things safe)
      if (!y || !m || !d) return new Date().toISOString().slice(0, 10);
      return `${y}-${m}-${d}`;
    }

    const todayOrderDate = todayISODateInTZ(input.restaurant.timezone);

    // -------------------------
    // Pipeline-aware inventory
    // -------------------------
    const pipeline =
      (input as any)?.context?.pipelineBySku &&
      typeof (input as any).context.pipelineBySku === "object"
        ? ((input as any).context.pipelineBySku as Record<string, number>)
        : {};

    // Create a "prompt view" of skus that includes pipeline + effective on hand.
    // This DOES NOT change your real stored state; it's only what we send to Gemini.
    const skusForPrompt = (input.skus ?? []).map((s: any) => {
      const sku = String(s?.sku ?? "");
      const onHand = Number(s?.onHandUnits ?? 0);
      const pipe = Number(pipeline[sku] ?? 0);
      return {
        ...s,
        pipelineUnits: pipe,
        effectiveOnHandUnits: onHand + pipe,
      };
    });

    const inputForPrompt = {
      ...input,
      skus: skusForPrompt,
      context: {
        ...(input as any).context,
        // keep pipeline visible for debugging inside the prompt too
        pipelineBySku: pipeline,
      },
    };

    // 2) Tell Gemini to output STRICT JSON for PlanOutput
    const prompt =
      `You are Mozi, an AI purchasing assistant for a single-location restaurant.\n` +
      `Goal: balance profit and waste minimization given owner preferences.\n\n` +
      `Return ONLY valid JSON. No markdown. No extra text.\n` +
      `Your JSON MUST match this TypeScript shape (PlanOutput):\n` +
      `{\n` +
      `  "generatedAt": string,\n` +
      `  "horizonDays": number,\n` +
      `  "orders": [\n` +
      `    {\n` +
      `      "supplierId": string,\n` +
      `      "orderDate": "YYYY-MM-DD",\n` +
      `      "items": [\n` +
      `        {\n` +
      `          "sku": string,\n` +
      `          "orderUnits": number,\n` +
      `          "reason": string,\n` +
      `          "riskNote"?: "waste_risk" | "stockout_risk" | "balanced",\n` +
      `          "confidence"?: number\n` +
      `        }\n` +
      `      ]\n` +
      `    }\n` +
      `  ],\n` +
      `  "summary": { "keyDrivers": string[], "warnings"?: string[] }\n` +
      `}\n\n` +
      `Use these inputs (JSON):\n` +
      `${JSON.stringify(inputForPrompt, null, 2)}\n\n` +
      `IMPORTANT INVENTORY RULE:\n` +
      `- Each input.skus[*] now includes:\n` +
      `  - onHandUnits (physical in-house)\n` +
      `  - pipelineUnits (already ordered, not arrived)\n` +
      `  - effectiveOnHandUnits = onHandUnits + pipelineUnits\n` +
      `- When deciding orderUnits, you MUST use effectiveOnHandUnits (not onHandUnits).\n\n` +
      `Rules:\n` +
      `- Inventory math: effectiveOnHandUnits = onHandUnits + pipelineUnits.\n` +
      `- Treat pipelineUnits as already purchased (do NOT reorder as if it doesn't exist).\n` +
      `- If effectiveOnHandUnits covers expected usage through the horizon, orderUnits MUST be omitted.\n` +
      `- If a SKU has avgDailyUsage (or similar), treat "covers expected usage through the horizon" as: effectiveOnHandUnits >= avgDailyUsage * horizonDays.\n` +
      `- Only recommend SKUs that exist in input.skus[*].sku.\n` +
      `- supplierId must match one of input.suppliers[*].supplierId.\n` +
      `- Use horizonDays = input.restaurant.planningHorizonDays.\n` +
      `- Use timezone = input.restaurant.timezone when choosing orderDate.\n` +
      `- Respect input.ownerPrefs.strategy (min_waste vs balanced vs min_stockouts).\n` +
      `- Bias toward neverRunOutSkus (strongest) and criticalSkus (strong).\n` +
      `- Keep orderUnits as a reasonable positive number; omit items rather than using 0.\n` +
      `- If required data is missing, include it in summary.warnings.\n`;

    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "models/gemini-2.5-pro",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        temperature: 0.7,
        topP: 0.95,
        topK: 64,
        maxOutputTokens: 2048,
      },
    });

    // 3) Parse JSON safely
    const raw = (response.text ?? "").trim();

    // If Gemini adds any extra text, try to grab the JSON object
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      return NextResponse.json(
        { error: "Model response had no JSON object", raw },
        { status: 502 }
      );
    }
    const jsonText = raw.slice(start, end + 1);

    let plan: PlanOutput;
    try {
      plan = JSON.parse(jsonText) as PlanOutput;
    } catch {
      return NextResponse.json(
        { error: "Model did not return valid JSON", raw },
        { status: 502 }
      );
    }

    // 4) Return structured plan
    // 4) Enforce constraints (prevent hallucinated SKUs/suppliers)
    const validSkus = new Set(input.skus.map((s) => s.sku));
    const validSuppliers = new Set(input.suppliers.map((s) => s.supplierId));

    plan.orders = (plan.orders ?? [])
      .filter((o) => validSuppliers.has(o.supplierId))
      .map((o) => ({
        ...o,
        // Force orderDate to be today in the restaurant timezone (removes "random date" issue)
        orderDate: todayOrderDate,
        items: (o.items ?? []).filter(
          (it) =>
            validSkus.has(it.sku) &&
            Number.isFinite(it.orderUnits) &&
            it.orderUnits > 0
        ),
      }))
      .filter((o) => o.items.length > 0);

    // Force generatedAt to be the server's actual time (prevents model "random dates")
    plan.generatedAt = new Date().toISOString();

    // Ensure horizonDays is consistent with input (model can still provide it, but we enforce)
    plan.horizonDays = input.restaurant.planningHorizonDays;

    // 5) Return structured plan
    return NextResponse.json(plan);
  } catch (err: any) {
    console.error("Gemini call failed:", err);
    return NextResponse.json(
      { error: "Gemini call failed", detail: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
