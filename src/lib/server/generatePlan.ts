// src/lib/server/generatePlan.ts
import { GoogleGenAI } from "@google/genai";
import type { PlanInput, PlanOutput } from "@/lib/types";
import crypto from "crypto";

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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function stableHash(obj: any): string {
  const s = JSON.stringify(obj);
  return crypto.createHash("sha256").update(s).digest("hex");
}

declare global {
  // eslint-disable-next-line no-var
  var __moziPlanInflight: Map<string, Promise<any>> | undefined;
  // eslint-disable-next-line no-var
  var __moziPlanCache: Map<string, { at: number; plan: any }> | undefined;
}

function inflightStore(): Map<string, Promise<any>> {
  if (!global.__moziPlanInflight) global.__moziPlanInflight = new Map();
  return global.__moziPlanInflight;
}

function cacheStore(): Map<string, { at: number; plan: any }> {
  if (!global.__moziPlanCache) global.__moziPlanCache = new Map();
  return global.__moziPlanCache;
}

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
  if (!y || !m || !d) return new Date().toISOString().slice(0, 10);
  return `${y}-${m}-${d}`;
}

/**
 * Extract text from GenerateContentResponse (works across SDK variants).
 * Also returns a tiny debug preview if empty.
 */
function extractTextAndPreview(resp: any): { text: string; preview: any } {
  // Most stable path:
  const parts = resp?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    const joined = parts
      .map((p: any) => String(p?.text ?? ""))
      .join("")
      .trim();
    const preview = parts.slice(0, 4).map((p: any) => ({
      keys: Object.keys(p ?? {}),
      textPreview: String(p?.text ?? "").slice(0, 120),
    }));
    return { text: joined, preview };
  }

  // Fallbacks:
  if (typeof resp?.text === "string")
    return { text: resp.text.trim(), preview: null };

  return {
    text: "",
    preview: { note: "No candidates[0].content.parts found" },
  };
}

function safeStr(v: any): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function normalizeSupplierKey(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, "_");
}

/**
 * BIG FIX:
 * - Do NOT JSON.stringify full PlanInput (it can be huge and triggers MAX_TOKENS / empty output).
 * - Create a compact prompt payload.
 *
 * IMPORTANT (your change):
 * - This now prioritizes avgDailyConsumption coming from /api/state (sku.avgDailyConsumption),
 *   which you’re now attaching in /api/state from inventory meta.
 * - It also attempts to derive a supplierId from sku.supplier (name) if sku.supplierId is missing.
 */
function makeCompactPromptPayload(input: PlanInput) {
  const pipelineBySku: Record<string, number> =
    (input as any)?.context?.pipelineBySku &&
    typeof (input as any).context.pipelineBySku === "object"
      ? ((input as any).context.pipelineBySku as Record<string, number>)
      : {};

  // Keep this small. If you have tons of SKUs, cap it.
  const MAX_SKUS = 60;

  // Build a supplier lookup that can match by supplierId OR by name-ish fields if present.
  const supplierById = new Map<string, any>();
  const supplierByNameKey = new Map<string, any>();

  for (const s of input.suppliers ?? []) {
    const supplierId = safeStr((s as any)?.supplierId);
    if (supplierId) supplierById.set(supplierId, s);

    const name = safeStr((s as any)?.name);
    if (name) supplierByNameKey.set(normalizeSupplierKey(name), s);

    // some of your code uses supplierId like "meatco" but UI meta uses "Sysco" — try also key by supplierId normalized
    if (supplierId) supplierByNameKey.set(normalizeSupplierKey(supplierId), s);
  }

  const skus = (input.skus ?? []).slice(0, MAX_SKUS).map((s: any) => {
    const sku = safeStr(s?.sku);
    const onHand = Number(s?.onHandUnits ?? 0);
    const pipe = Number(pipelineBySku[sku] ?? 0);

    // Prefer explicit supplierId on SKU (if your backend has it),
    // else try to map sku.supplier (string name) -> a supplier object -> supplierId.
    const explicitSupplierId = safeStr(s?.supplierId);
    const supplierName = safeStr(s?.supplier); // from inventory meta /api/state attachment
    let derivedSupplierId: string | undefined = explicitSupplierId || undefined;

    if (!derivedSupplierId && supplierName) {
      const hit =
        supplierByNameKey.get(normalizeSupplierKey(supplierName)) ||
        supplierById.get(supplierName); // if they accidentally stored supplierId into "supplier"
      const candidate = safeStr((hit as any)?.supplierId);
      if (candidate) derivedSupplierId = candidate;
    }

    // IMPORTANT: this is the field we want the AI to use.
    // /api/state now attaches avgDailyConsumption onto each sku entry.
    const avgDailyConsumptionNum = Number(
      s?.avgDailyConsumption ??
        s?.avgDailyUsage ??
        (s as any)?.avgDailyDemand ??
        0
    );

    const useByDaysNum = Number(s?.useByDays ?? (s as any)?.shelfLifeDays ?? 0);
    const priceUsdNum = Number(s?.priceUsd ?? 0);

    return {
      sku,
      // inventory
      onHandUnits: onHand,
      pipelineUnits: pipe,
      effectiveOnHandUnits: onHand + pipe,

      // signals
      avgDailyConsumption:
        Number.isFinite(avgDailyConsumptionNum) && avgDailyConsumptionNum > 0
          ? avgDailyConsumptionNum
          : undefined,

      useByDays:
        Number.isFinite(useByDaysNum) && useByDaysNum > 0
          ? Math.floor(useByDaysNum)
          : undefined,

      priceUsd:
        Number.isFinite(priceUsdNum) && priceUsdNum > 0
          ? priceUsdNum
          : undefined,

      supplierId: derivedSupplierId,
      supplierName: supplierName || undefined,

      critical: Boolean((s as any)?.critical),
      neverRunOut: Boolean((s as any)?.neverRunOut),
    };
  });

  const suppliers = (input.suppliers ?? []).map((s: any) => ({
    supplierId: safeStr(s?.supplierId),
    name: safeStr(s?.name) || undefined,
    leadTimeDays: Number(s?.leadTimeDays ?? 0) || undefined,
  }));

  const additionalContext =
    String((input as any)?.context?.notes ?? "").trim() ||
    String((input as any)?.context?.additionalContext ?? "").trim();

  return {
    restaurant: {
      timezone: input.restaurant.timezone,
      planningHorizonDays: input.restaurant.planningHorizonDays,
    },
    ownerPrefs: {
      strategy: (input as any)?.ownerPrefs?.strategy ?? "balanced",
    },

    // ✅ NEW: send the text the user typed so the model can use it
    additionalContext,

    skus,
    suppliers,
    meta: {
      skuCountSent: skus.length,
      skuCountTotal: (input.skus ?? []).length,
    },
  };
}

async function callGeminiForJson(args: {
  ai: GoogleGenAI;
  prompt: string;
  timeoutMs: number;
}) {
  const { ai, prompt, timeoutMs } = args;

  let lastErr: any = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await withTimeout(
        ai.models.generateContent({
          model: "models/gemini-2.5-pro",
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          config: {
            temperature: 0.2,
            topP: 0.9,
            topK: 40,

            // IMPORTANT: give it plenty of output tokens
            maxOutputTokens: 8192,

            // IMPORTANT: JSON-only
            responseMimeType: "application/json",

            // CRITICAL FIX: limit/disable deep thinking (TS may not know this field; keep as any)
            // This prevents "thinking eats all tokens, no final answer" behavior.
            ...({ thinkingConfig: { thinkingBudget: 512 } } as any),
          } as any,
        }),
        timeoutMs,
        `Gemini generateContent (attempt ${attempt + 1})`
      );

      const { text, preview } = extractTextAndPreview(resp);

      if (text)
        return {
          text,
          debug: {
            preview,
            finishReason: resp?.candidates?.[0]?.finishReason ?? null,
          },
        };

      console.error("[generatePlan] Gemini returned empty text", {
        attempt,
        hasCandidates: Boolean(resp?.candidates?.length),
        finishReason: resp?.candidates?.[0]?.finishReason ?? null,
        partsPreview: preview,
      });
    } catch (e: any) {
      lastErr = e;
      console.error("[generatePlan] Gemini error", {
        attempt,
        err: String(e?.message ?? e),
      });
    }

    await sleep(600 * (attempt + 1));
  }

  throw lastErr ?? new Error("Gemini returned empty text");
}

export async function generatePlan(input: PlanInput): Promise<PlanOutput> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY");

  if (
    !input ||
    !input.restaurant ||
    typeof input.restaurant.planningHorizonDays !== "number" ||
    typeof input.restaurant.timezone !== "string" ||
    !Array.isArray(input.skus) ||
    !Array.isArray(input.suppliers)
  ) {
    throw new Error("Invalid PlanInput: missing skus or suppliers arrays");
  }

  const todayOrderDate = todayISODateInTZ(input.restaurant.timezone);
  const compact = makeCompactPromptPayload(input);

  const prompt =
    `You are Mozi, an AI purchasing assistant for a single-location restaurant.\n` +
    `Return ONLY valid JSON matching PlanOutput. No markdown. No commentary.\n\n` +
    `PRIMARY GOAL:\n` +
    `Prevent stockouts. When uncertain, having a BIGGER buffer is better than risking running out.\n` +
    `Bias toward ordering slightly MORE rather than risking stockouts.\n` +
    `Recompute from scratch every run (do NOT "cool down" due to prior orders).\n` +
    `Use supplier lead times + safety buffer to decide what must be ordered now.\n\n` +
    `You MUST base quantities primarily on:\n` +
    `- avgDailyConsumption (units/day)\n` +
    `- supplier leadTimeDays (days)\n` +
    `- useByDays (shelf life in days)\n` +
    `- effectiveOnHandUnits (onHandUnits + pipelineUnits)\n` +
    `planningHorizonDays is SECONDARY and should have minimal impact.\n\n` +
    `PlanOutput schema:\n` +
    `{\n` +
    `  "generatedAt": string,\n` +
    `  "horizonDays": number,\n` +
    `  "orders": [{\n` +
    `    "supplierId": string,\n` +
    `    "orderDate": "YYYY-MM-DD",\n` +
    `    "items": [{\n` +
    `      "sku": string,\n` +
    `      "orderUnits": number,\n` +
    `      "reason": string,\n` +
    `      "riskNote"?: "waste_risk"|"stockout_risk"|"balanced",\n` +
    `      "confidence"?: number\n` +
    `    }]\n` +
    `  }],\n` +
    `  "summary": { "keyDrivers": string[], "warnings"?: string[], "contextApplied"?: string[] }\n` +
    `}\n\n` +
    `Hard rules (must follow):\n` +
    `1) Only use sku values from inputs.skus[].sku.\n` +
    `2) Only use supplierId values from inputs.suppliers[].supplierId.\n` +
    `3) Never output items with orderUnits <= 0. If you would output 0, OMIT the SKU.\n` +
    `4) Do NOT buy “random extras”. Only order when the math says you are below the target or reorder point.\n` +
    `5) For every ordered item, item.reason MUST include numbers:\n` +
    `   daily, useByDays, leadTimeDays, targetOnHandUnits, effectiveOnHandUnits, reorderPointUnits, shortage.\n` +
    `6) You MUST read and apply inputs.additionalContext if it contains any demand/constraint signal.\n` +
    `7) For every ordered item, item.reason must explicitly say whether additionalContext affected this SKU.\n` +
    `8) summary.contextApplied must list the concrete changes you made due to additionalContext (or "No actionable context found").\n` +
    `9) Non-perishables (useByDays >= 30): still prevent stockouts.\n` +
    `   Use leadTimeDays + safety buffer and order when below reorderPointUnits.\n` +
    `10) Do NOT reduce ordering because an order was recently placed. Each run is independent.\n` +
    `11) You MUST use supplier leadTimeDays when available to determine reorder urgency.\n` +
    `12) If a SKU has daily > 0 and effectiveOnHandUnits is below reorderPointUnits, you MUST order (do not omit).\n\n` +
    `Core calculation rules (do the math — lead time + safety, bounded by shelf life):\n` +
    `- daily = sku.avgDailyConsumption (units/day). If missing/0, treat daily as 0 and OMIT.\n` +
    `- useBy = sku.useByDays (days). If missing/0, treat useBy as 30.\n` +
    `- lead = supplier.leadTimeDays for this SKU's supplierId; if unknown/missing, lead = 3.\n` +
    `- safetyDays = 2  // stockout-averse default\n` +
    `- coverDays = clamp(lead + safetyDays, 1, 10)\n` +
    `- perishableCapDays = clamp(useBy, 1, 14)\n` +
    `- effectiveCoverDays = min(coverDays, perishableCapDays)\n` +
    `- baseTarget = daily * effectiveCoverDays\n` +
    `- safetyStockUnits = max(1, ceil(daily * 0.5))  // extra buffer; bigger buffer is better\n` +
    `- targetOnHandUnits = baseTarget + safetyStockUnits\n` +
    `\n` +
    `Reorder point (MUST order if crossed):\n` +
    `- reorderPointUnits = daily * clamp(lead + 1, 1, 10)\n` +
    `\n` +
    `Strategy handling (still stockout-averse):\n` +
    `- If inputs.ownerPrefs.strategy is "minimize_waste": targetOnHandUnits = targetOnHandUnits * 0.95\n` +
    `- If inputs.ownerPrefs.strategy is "balanced": targetOnHandUnits = targetOnHandUnits * 1.10\n` +
    `- If inputs.ownerPrefs.strategy is "minimize_stockouts": targetOnHandUnits = targetOnHandUnits * 1.25\n` +
    `- Otherwise: targetOnHandUnits = targetOnHandUnits * 1.10\n` +
    `\n` +
    `Ordering logic (MUST avoid stockouts):\n` +
    `- effectiveOnHandUnits = sku.effectiveOnHandUnits\n` +
    `- shortage = targetOnHandUnits - effectiveOnHandUnits\n` +
    `- belowReorderPoint = effectiveOnHandUnits <= reorderPointUnits\n` +
    `- If belowReorderPoint: you MUST order at least max(1, ceil(shortage)).\n` +
    `- Otherwise: orderUnits = ceil(max(0, shortage)).\n` +
    `\n` +
    `Perishables safety (STRICT but stockout-averse):\n` +
    `- If useBy <= 2: cap orderUnits at ceil(daily * useBy + 1) (small extra is OK; bigger buffer is better).\n` +
    `- If useBy <= 3: be conservative; do not exceed ceil(targetOnHandUnits).\n` +
    `- If daily is small and useBy is small, it is OK to order 0 ONLY if NOT belowReorderPoint.\n` +
    `\n` +
    `Planning horizon (MINIMAL impact):\n` +
    `- DO NOT try to cover daily * planningHorizonDays.\n` +
    `- Only use planningHorizonDays for narrative + upcoming events adjustments.\n\n` +
    `Upcoming events handling:\n` +
    `- If additionalContext or context notes mention an upcoming event or demand lift, adjust daily upward only for clearly related SKUs.\n` +
    `- Keep adjustments modest unless the context is explicit.\n\n` +
    `Risk notes:\n` +
    `- If belowReorderPoint OR shortage >= daily => riskNote "stockout_risk"\n` +
    `- If useBy <= 3 and orderUnits is near the perishable cap (>= 0.9 * (daily*useBy + 1)) => "waste_risk"\n` +
    `- Otherwise "balanced"\n\n` +
    `Grouping & simplicity:\n` +
    `- Group items by supplierId.\n` +
    `- Prefer ordering from sku.supplierId when present; otherwise choose a reasonable supplierId from inputs.suppliers.\n` +
    `- Keep reasons short and numeric.\n\n` +
    `Output expectations:\n` +
    `- "reason" must include: daily, useByDays, leadTimeDays, targetOnHandUnits, effectiveOnHandUnits, reorderPointUnits, shortage,\n` +
    `  and whether context changed anything.\n` +
    `- "summary.keyDrivers" must mention lead-time coverage, safety buffer, and shelf-life bounds.\n\n` +
    `Inputs JSON:\n` +
    `${JSON.stringify(compact)}\n`;

  const ai = new GoogleGenAI({ apiKey });

  const key = stableHash({
    model: "models/gemini-2.5-pro",
    compact,
  });

  const cache = cacheStore();
  const CACHE_TTL_MS = 25_000;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.plan;

  const inflight = inflightStore();
  let p = inflight.get(key);

  if (!p) {
    p = (async () => {
      const { text } = await callGeminiForJson({
        ai,
        prompt,
        timeoutMs: 90_000,
      });
      return text;
    })();

    inflight.set(key, p);
    p.finally(() => inflight.delete(key));
  }

  const raw = String(await p).trim();
  if (!raw) throw new Error("Gemini returned empty text");

  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object from model");
  }

  let plan: PlanOutput;
  try {
    plan = JSON.parse(raw.slice(start, end + 1)) as PlanOutput;
  } catch {
    throw new Error("Model did not return valid JSON");
  }

  // Enforce constraints
  const validSkus = new Set(
    (input.skus ?? []).map((s: any) => String(s?.sku ?? ""))
  );
  const validSuppliers = new Set(
    (input.suppliers ?? []).map((s: any) => String(s?.supplierId ?? ""))
  );

  plan.orders = (plan.orders ?? [])
    .filter((o: any) => validSuppliers.has(String(o?.supplierId ?? "")))
    .map((o: any) => ({
      ...o,
      orderDate: todayOrderDate,
      items: (o.items ?? []).filter(
        (it: any) =>
          validSkus.has(String(it?.sku ?? "")) &&
          Number.isFinite(it?.orderUnits) &&
          it.orderUnits > 0
      ),
    }))
    .filter((o: any) => o.items.length > 0);

  plan.generatedAt = new Date().toISOString();
  plan.horizonDays = input.restaurant.planningHorizonDays;

  // Warn if we truncated SKU list
  if ((input.skus ?? []).length > 60) {
    plan.summary = plan.summary ?? { keyDrivers: [] };
    plan.summary.warnings = [
      ...(plan.summary.warnings ?? []),
      `Too many SKUs (${
        (input.skus ?? []).length
      }). Sent only first 60 to the model.`,
    ];
  }

  cache.set(key, { at: Date.now(), plan });
  return plan;
}
