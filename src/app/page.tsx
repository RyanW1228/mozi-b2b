"use client";

import { useState } from "react";

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [explanation, setExplanation] = useState<string>("");

  async function generate() {
    setLoading(true);
    setExplanation("");
    try {
      const sampleInput = {
        restaurant: {
          id: "demo_restaurant_1",
          name: "Demo Restaurant",
          timezone: "America/New_York",
          cadence: "weekly",
          planningHorizonDays: 7,
        },
        ownerPrefs: {
          strategy: "balanced",
          maxWastePercent: 5,
          criticalSkus: ["chicken_breast", "ground_beef"],
          // neverRunOutSkus: ["chicken_breast"], // optional
        },
        suppliers: [
          { supplierId: "meatco", name: "MeatCo", leadTimeDays: 2 },
          { supplierId: "produceco", name: "ProduceCo", leadTimeDays: 1 },
        ],
        skus: [
          {
            sku: "chicken_breast",
            name: "Chicken Breast",
            unit: "lb",
            shelfLifeDays: 3,
            supplierId: "meatco",
            unitCostUsd: 3.5,
          },
          {
            sku: "ground_beef",
            name: "Ground Beef",
            unit: "lb",
            shelfLifeDays: 2,
            supplierId: "meatco",
            unitCostUsd: 4.0,
          },
          {
            sku: "romaine_lettuce",
            name: "Romaine Lettuce",
            unit: "each",
            shelfLifeDays: 5,
            supplierId: "produceco",
            unitCostUsd: 1.25,
          },
        ],
        inventory: [
          { sku: "chicken_breast", onHandUnits: 12 },
          { sku: "ground_beef", onHandUnits: 8 },
          { sku: "romaine_lettuce", onHandUnits: 20 },
        ],
        sales: {
          windowDays: 7,
          bySku: [
            { sku: "chicken_breast", unitsSold: 40 },
            { sku: "ground_beef", unitsSold: 35 },
            { sku: "romaine_lettuce", unitsSold: 22 },
          ],
        },
        context: {
          season: "winter",
          notes: "Normal week",
        },
      };

      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sampleInput),
      });

      const data = await res.json();
      if (!res.ok) {
        setExplanation(`HTTP ${res.status}\n` + JSON.stringify(data, null, 2));
      } else {
        setExplanation(JSON.stringify(data, null, 2));
      }
    } catch (e: any) {
      setExplanation(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 28, fontWeight: 700 }}>Mozi (B2B) – v1</h1>
      <p style={{ marginTop: 8, maxWidth: 700 }}>
        Click the button to call your backend endpoint <code>/api/plan</code>{" "}
        and show Gemini’s explanation.
      </p>

      <button
        onClick={generate}
        disabled={loading}
        style={{
          marginTop: 16,
          padding: "10px 14px",
          borderRadius: 10,
          border: "1px solid #ddd",
          cursor: loading ? "not-allowed" : "pointer",
        }}
      >
        {loading ? "Generating..." : "Generate Purchase Explanation"}
      </button>

      <pre
        style={{
          marginTop: 16,
          padding: 16,
          borderRadius: 12,
          border: "1px solid #eee",
          whiteSpace: "pre-wrap",
        }}
      >
        {explanation || "No output yet."}
      </pre>
    </main>
  );
}
