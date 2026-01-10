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

/**
 * BIG FIX:
 * - Do NOT JSON.stringify full PlanInput (it can be huge and triggers MAX_TOKENS / empty output).
 * - Create a compact prompt payload.
 */
function makeCompactPromptPayload(input: PlanInput) {
  const pipelineBySku: Record<string, number> =
    (input as any)?.context?.pipelineBySku &&
    typeof (input as any).context.pipelineBySku === "object"
      ? ((input as any).context.pipelineBySku as Record<string, number>)
      : {};

  // Keep this small. If you have tons of SKUs, cap it.
  const MAX_SKUS = 60;

  const skus = (input.skus ?? []).slice(0, MAX_SKUS).map((s: any) => {
    const sku = String(s?.sku ?? "");
    const onHand = Number(s?.onHandUnits ?? 0);
    const pipe = Number(pipelineBySku[sku] ?? 0);

    return {
      sku,
      // inventory
      onHandUnits: onHand,
      pipelineUnits: pipe,
      effectiveOnHandUnits: onHand + pipe,

      // helpful signals (only if present)
      avgDailyConsumption:
        Number(s?.avgDailyConsumption ?? s?.avgDailyUsage ?? 0) || undefined,
      useByDays: Number(s?.useByDays ?? 0) || undefined,
      priceUsd: Number(s?.priceUsd ?? 0) || undefined,

      supplierId: s?.supplierId ? String(s.supplierId) : undefined,
      critical: Boolean((s as any)?.critical),
      neverRunOut: Boolean((s as any)?.neverRunOut),
    };
  });

  const suppliers = (input.suppliers ?? []).map((s: any) => ({
    supplierId: String(s?.supplierId ?? ""),
    leadTimeDays: Number(s?.leadTimeDays ?? 0) || undefined,
  }));

  return {
    restaurant: {
      timezone: input.restaurant.timezone,
      planningHorizonDays: input.restaurant.planningHorizonDays,
    },
    ownerPrefs: {
      strategy: (input as any)?.ownerPrefs?.strategy ?? "balanced",
    },
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
    `PlanOutput schema:\n` +
    `{\n` +
    `  "generatedAt": string,\n` +
    `  "horizonDays": number,\n` +
    `  "orders": [{ "supplierId": string, "orderDate": "YYYY-MM-DD", "items": [{ "sku": string, "orderUnits": number, "reason": string, "riskNote"?: "waste_risk"|"stockout_risk"|"balanced", "confidence"?: number }] }],\n` +
    `  "summary": { "keyDrivers": string[], "warnings"?: string[] }\n` +
    `}\n\n` +
    `Rules:\n` +
    `- Use effectiveOnHandUnits (onHandUnits + pipelineUnits).\n` +
    `- If effectiveOnHandUnits covers horizon demand, OMIT that SKU (do not output 0).\n` +
    `- Only use supplierId values from suppliers[].supplierId.\n` +
    `- Only use sku values from skus[].sku.\n\n` +
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
