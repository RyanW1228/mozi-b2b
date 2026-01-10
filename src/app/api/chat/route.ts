// src/app/api/chat/route.ts
export const runtime = "nodejs";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

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

async function extractGeminiText(resp: any): Promise<string> {
  if (typeof resp?.text === "string") return resp.text;
  if (typeof resp?.text === "function") {
    try {
      const t = await resp.text();
      if (typeof t === "string") return t;
    } catch {}
  }
  const parts = resp?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts))
    return parts.map((p: any) => String(p?.text ?? "")).join("");
  return "";
}

type ChatReq = {
  ownerAddress?: string;
  env?: "testing" | "production";
  locationId?: string;

  // current restaurant snapshot (optional but recommended)
  restaurantContext?: any;

  // persistent “notes / preferences”
  memory?: string;

  // chat thread
  messages: Array<{ role: "user" | "assistant"; content: string }>;

  // latest user message (convenience)
  userMessage: string;
};

export async function POST(req: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { ok: false, error: "Missing GEMINI_API_KEY" },
        { status: 500 }
      );
    }

    const body = (await req.json()) as ChatReq;

    if (!body?.userMessage || !Array.isArray(body?.messages)) {
      return NextResponse.json(
        { ok: false, error: "Invalid request: missing userMessage/messages" },
        { status: 400 }
      );
    }

    const memory = String(body.memory ?? "").trim();
    const ctx = body.restaurantContext ?? null;

    // System rules: explicitly forbid plan + forbid order creation
    const system =
      `You are Mozi Chat, a restaurant copilot.\n` +
      `You MUST NOT create a purchase plan and MUST NOT output an "orders" array.\n` +
      `You MUST NOT propose, create, or trigger on-chain orders.\n` +
      `You are allowed to: answer questions, suggest ideas, ask clarifying questions, and record future-order notes.\n\n` +
      `Return ONLY valid JSON with this exact shape:\n` +
      `{\n` +
      `  "reply": string,\n` +
      `  "memoryAppend"?: string\n` +
      `}\n\n` +
      `- "reply" is what you say to the user.\n` +
      `- "memoryAppend" is OPTIONAL: short text to append to saved notes if the user gave durable info (events, vendor constraints, recurring preferences).\n` +
      `- If nothing should be saved, omit memoryAppend.\n` +
      `- No markdown, no extra keys.\n`;

    // Include context + memory for better answers
    const prompt =
      system +
      `\nSaved notes (may be empty):\n` +
      `${memory ? memory : "(none)"}\n\n` +
      `Restaurant context (may be null):\n` +
      `${ctx ? JSON.stringify(ctx).slice(0, 20_000) : "null"}\n\n` +
      `Conversation:\n` +
      body.messages
        .slice(-16) // keep last N turns short
        .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
        .join("\n") +
      `\n\nUSER: ${body.userMessage}\n`;

    const ai = new GoogleGenAI({ apiKey });

    const resp = await withTimeout(
      ai.models.generateContent({
        model: "models/gemini-2.5-pro",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          temperature: 0.4,
          topP: 0.9,
          topK: 40,
          maxOutputTokens: 1200,
          responseMimeType: "application/json",
        },
      }),
      45_000,
      "Gemini chat"
    );

    const raw = (await extractGeminiText(resp)).trim();
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      return NextResponse.json(
        { ok: false, error: "Model response had no JSON object", raw },
        { status: 502 }
      );
    }

    const jsonText = raw.slice(start, end + 1);
    const out = JSON.parse(jsonText) as {
      reply: string;
      memoryAppend?: string;
    };

    if (typeof out?.reply !== "string") {
      return NextResponse.json(
        { ok: false, error: "Bad model JSON: missing reply", raw: jsonText },
        { status: 502 }
      );
    }

    // IMPORTANT: This route does NOT create any plans or orders. It just chats.
    return NextResponse.json({
      ok: true,
      reply: out.reply,
      memoryAppend:
        typeof out.memoryAppend === "string" ? out.memoryAppend : undefined,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Chat failed", detail: String(e?.message ?? e) },
      { status: 502 }
    );
  }
}
