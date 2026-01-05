"use client";

import { useState } from "react";
import type { PlanInput, PlanOutput } from "@/lib/types";
import Link from "next/link";

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState<PlanOutput | null>(null);
  const [error, setError] = useState<string>("");

  const [strategy, setStrategy] =
    useState<PlanInput["ownerPrefs"]["strategy"]>("balanced");
  const [horizonDays, setHorizonDays] = useState<number>(7);
  const [notes, setNotes] = useState<string>("Normal week");

  async function generate() {
    setLoading(true);
    setError("");
    setPlan(null);
    try {
      const stateRes = await fetch("/api/state");
      const sampleInput = (await stateRes.json()) as PlanInput;

      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sampleInput),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(`HTTP ${res.status}\n` + JSON.stringify(data, null, 2));
      } else {
        setPlan(data as PlanOutput);
      }
    } catch (e: any) {
      setError(String(e));
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

      <div
        style={{
          marginTop: 16,
          padding: 16,
          borderRadius: 12,
          border: "1px solid #eee",
          maxWidth: 700,
          display: "grid",
          gap: 12,
        }}
      >
        <div style={{ display: "grid", gap: 6 }}>
          <label style={{ fontWeight: 600 }}>Strategy</label>
          <select
            value={strategy}
            onChange={(e) =>
              setStrategy(e.target.value as PlanInput["ownerPrefs"]["strategy"])
            }
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid #ddd",
            }}
          >
            <option value="min_waste">min_waste (minimize waste)</option>
            <option value="balanced">balanced</option>
            <option value="min_stockouts">
              min_stockouts (avoid stockouts)
            </option>
          </select>
        </div>

        <div style={{ display: "grid", gap: 6 }}>
          <label style={{ fontWeight: 600 }}>Planning horizon (days)</label>
          <input
            type="number"
            min={1}
            max={30}
            value={horizonDays}
            onChange={(e) => setHorizonDays(Number(e.target.value))}
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid #ddd",
            }}
          />
        </div>

        <div style={{ display: "grid", gap: 6 }}>
          <label style={{ fontWeight: 600 }}>Notes (context)</label>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder='e.g. "Football weekend"'
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid #ddd",
            }}
          />
        </div>
      </div>

      <div
        style={{
          marginTop: 16,
          display: "flex",
          gap: 10,
          alignItems: "center",
        }}
      >
        <button
          onClick={generate}
          disabled={loading}
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid #ddd",
            cursor: loading ? "not-allowed" : "pointer",
            fontWeight: 600,
          }}
        >
          {loading ? "Generating..." : "Generate Purchase Plan"}
        </button>

        <Link
          href="/inventory"
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid #ddd",
            textDecoration: "none",
            color: "inherit",
            display: "inline-block",
            fontWeight: 600,
          }}
        >
          Inventory
        </Link>
      </div>

      {error ? (
        <pre
          style={{
            marginTop: 16,
            padding: 16,
            borderRadius: 12,
            border: "1px solid #f3c",
            whiteSpace: "pre-wrap",
          }}
        >
          {error}
        </pre>
      ) : plan ? (
        <div style={{ marginTop: 16, display: "grid", gap: 16, maxWidth: 900 }}>
          <div
            style={{
              padding: 16,
              borderRadius: 12,
              border: "1px solid #eee",
              display: "grid",
              gap: 8,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div>
                <div style={{ fontWeight: 700, fontSize: 18 }}>
                  Purchase Plan
                </div>
                <div style={{ color: "#555", marginTop: 4 }}>
                  Generated: {plan.generatedAt} • Horizon: {plan.horizonDays}{" "}
                  days
                </div>
              </div>
            </div>

            {plan.summary?.keyDrivers?.length ? (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontWeight: 600 }}>Key drivers</div>
                <ul style={{ marginTop: 6 }}>
                  {plan.summary.keyDrivers.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {plan.summary?.warnings?.length ? (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontWeight: 600 }}>Warnings</div>
                <ul style={{ marginTop: 6 }}>
                  {plan.summary.warnings.map((w, i) => (
                    <li key={i} style={{ color: "#a00" }}>
                      {w}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          {plan.orders.map((order, idx) => (
            <div
              key={idx}
              style={{
                padding: 16,
                borderRadius: 12,
                border: "1px solid #eee",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <div>
                  <div style={{ fontWeight: 700 }}>
                    Supplier: {order.supplierId}
                  </div>
                  <div style={{ color: "#555", marginTop: 4 }}>
                    Order date: {order.orderDate}
                  </div>
                </div>

                <button
                  onClick={() =>
                    alert(`Approved order for ${order.supplierId}`)
                  }
                  style={{
                    padding: "8px 12px",
                    borderRadius: 10,
                    border: "1px solid #ddd",
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  Approve
                </button>
              </div>

              <div style={{ marginTop: 12, overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th
                        style={{
                          textAlign: "left",
                          padding: 8,
                          borderBottom: "1px solid #eee",
                        }}
                      >
                        SKU
                      </th>
                      <th
                        style={{
                          textAlign: "right",
                          padding: 8,
                          borderBottom: "1px solid #eee",
                        }}
                      >
                        Units
                      </th>
                      <th
                        style={{
                          textAlign: "left",
                          padding: 8,
                          borderBottom: "1px solid #eee",
                        }}
                      >
                        Risk
                      </th>
                      <th
                        style={{
                          textAlign: "right",
                          padding: 8,
                          borderBottom: "1px solid #eee",
                        }}
                      >
                        Conf.
                      </th>
                      <th
                        style={{
                          textAlign: "left",
                          padding: 8,
                          borderBottom: "1px solid #eee",
                        }}
                      >
                        Reason
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.items.map((it, j) => (
                      <tr key={j}>
                        <td
                          style={{
                            padding: 8,
                            borderBottom: "1px solid #f5f5f5",
                          }}
                        >
                          {it.sku}
                        </td>
                        <td
                          style={{
                            padding: 8,
                            borderBottom: "1px solid #f5f5f5",
                            textAlign: "right",
                          }}
                        >
                          {it.orderUnits}
                        </td>
                        <td
                          style={{
                            padding: 8,
                            borderBottom: "1px solid #f5f5f5",
                          }}
                        >
                          {it.riskNote ?? "—"}
                        </td>
                        <td
                          style={{
                            padding: 8,
                            borderBottom: "1px solid #f5f5f5",
                            textAlign: "right",
                          }}
                        >
                          {typeof it.confidence === "number"
                            ? it.confidence.toFixed(2)
                            : "—"}
                        </td>
                        <td
                          style={{
                            padding: 8,
                            borderBottom: "1px solid #f5f5f5",
                          }}
                        >
                          {it.reason}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ marginTop: 16, color: "#555" }}>No output yet.</div>
      )}
    </main>
  );
}
