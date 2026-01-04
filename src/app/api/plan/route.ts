export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";

export async function POST() {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing GEMINI_API_KEY" },
        { status: 500 }
      );
    }

    const ai = new GoogleGenAI({ apiKey });

    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: [
        {
          role: "user",
          parts: [
            {
              text:
                "You are helping a restaurant owner. Explain in 3 bullet points why an AI would order more chicken this week.\n" +
                "Context: higher sales last week; chicken shelf life 3 days; supplier lead time 2 days; owner wants balanced waste vs stockout risk.",
            },
          ],
        },
      ],
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });

    return NextResponse.json({ explanation: response.text });
  } catch (err: any) {
    console.error("Gemini call failed:", err);
    return NextResponse.json(
      { error: "Gemini call failed", detail: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
