// src/app/locations/[locationId]/page.tsx
"use client";

import { useMemo, useState } from "react";
import type { PlanInput, PlanOutput } from "@/lib/types";
import Link from "next/link";
import { useParams } from "next/navigation";
import { buildPaymentIntentFromPlan } from "@/lib/pricing";
import { isAddress } from "ethers";

const COLORS = {
  text: "#0f172a",
  subtext: "#64748b",
  card: "#ffffff",
  border: "#e5e7eb",

  primary: "#2563eb",
  buttonTextLight: "#ffffff",

  dangerText: "#991b1b",
  dangerBg: "#fef2f2",
  dangerBorder: "#fecaca",

  warnText: "#92400e",
  warnBg: "#fffbeb",
  warnBorder: "#fde68a",

  greenText: "#065f46",
  greenBg: "#f0fdf4",
  greenBorder: "#bbf7d0",
};

function shortenId(id: string) {
  if (!id) return "—";
  return id.length <= 14 ? id : `${id.slice(0, 8)}…${id.slice(-4)}`;
}

export default function LocationPage() {
  const params = useParams<{ locationId: string }>();

  const locationId = useMemo(() => {
    const v = params?.locationId;
    if (typeof v === "string") return v;
    if (Array.isArray(v)) return v[0];
    return "";
  }, [params]);

  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState<PlanOutput | null>(null);
  const [error, setError] = useState<string>("");

  const [strategy, setStrategy] =
    useState<PlanInput["ownerPrefs"]["strategy"]>("balanced");
  const [horizonDays, setHorizonDays] = useState<number>(7);
  const [notes, setNotes] = useState<string>("Normal week");

  const [paymentIntent, setPaymentIntent] = useState<any>(null);
  const [executeResp, setExecuteResp] = useState<any>(null);

  const cardStyle: React.CSSProperties = {
    marginTop: 16,
    padding: 16,
    background: COLORS.card,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 14,
    boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
    display: "flex",
    flexDirection: "column",
    gap: 12,
  };

  const btnPrimary = (disabled?: boolean): React.CSSProperties => ({
    padding: "10px 14px",
    borderRadius: 12,
    background: COLORS.primary,
    color: COLORS.buttonTextLight,
    border: "none",
    fontWeight: 900,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.65 : 1,
  });

  const btnSoft = (disabled?: boolean): React.CSSProperties => ({
    padding: "10px 14px",
    borderRadius: 12,
    background: "rgba(255,255,255,0.75)",
    border: `1px solid ${COLORS.border}`,
    color: COLORS.text,
    fontWeight: 900,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.65 : 1,
    textDecoration: "none",
    display: "inline-block",
  });

  async function generate() {
    if (!locationId) return;

    setLoading(true);
    setError("");
    setPlan(null);
    setPaymentIntent(null);
    setExecuteResp(null);

    try {
      const stateRes = await fetch(
        `/api/state?locationId=${encodeURIComponent(locationId)}`
      );

      if (!stateRes.ok) {
        const err = await stateRes.json();
        setError(
          `STATE HTTP ${stateRes.status}\n` + JSON.stringify(err, null, 2)
        );
        return;
      }

      const baseInput = (await stateRes.json()) as PlanInput;

      // Apply UI controls deterministically before calling /api/plan
      const input: PlanInput = {
        ...baseInput,
        restaurant: {
          ...baseInput.restaurant,
          id: locationId,
          planningHorizonDays: horizonDays,
        },
        ownerPrefs: {
          ...baseInput.ownerPrefs,
          strategy,
        },
        context: {
          ...(baseInput.context ?? {}),
          notes,
        },
      };

      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(`PLAN HTTP ${res.status}\n` + JSON.stringify(data, null, 2));
      } else {
        setPlan(data as PlanOutput);

        const pi = buildPaymentIntentFromPlan({
          input,
          plan: data as PlanOutput,
        });
        console.log("PAYMENT_INTENT", pi);
        setPaymentIntent(pi);
        setExecuteResp(null);

        // --- TEMP EXECUTE STEP (calls your /api/execute route) ---

        // 1) Read connected wallet address from localStorage (same key as homepage)
        const ownerAddress =
          typeof window !== "undefined"
            ? window.localStorage.getItem("mozi_wallet_address")
            : null;

        // 2) Validate it
        if (!ownerAddress || !isAddress(ownerAddress)) {
          setError(
            "No valid wallet found. Go to the homepage, connect wallet, then come back here."
          );
          return;
        }

        // 3) Call execute API with the shape it expects: { ownerAddress, paymentIntent }
        const execRes = await fetch(
          `/api/execute?locationId=${encodeURIComponent(locationId)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ownerAddress,
              input, // <-- include the PlanInput
              plan: data, // <-- include the PlanOutput (RAW from /api/plan)
              paymentIntent: pi, // <-- keep this too (harmless + useful for debugging)
            }),
          }
        );

        const execJson = await execRes.json();
        console.log("EXECUTE_RESPONSE", execJson);
        setExecuteResp(execJson);

        if (!execRes.ok) {
          setError(
            `EXECUTE HTTP ${execRes.status}\n` +
              JSON.stringify(execJson, null, 2)
          );
        }
      }
    } catch (e: any) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  if (!locationId) {
    return (
      <div
        style={{
          minHeight: "100vh",
          width: "100%",
          backgroundColor: "#dbeafe",
          backgroundImage: [
            "radial-gradient(1400px 750px at 50% -220px, rgba(37,99,235,0.35) 0%, rgba(37,99,235,0.18) 42%, rgba(219,234,254,0) 75%)",
            "radial-gradient(1100px 650px at 15% 25%, rgba(59,130,246,0.22) 0%, rgba(219,234,254,0) 62%)",
            "linear-gradient(180deg, #dbeafe 0%, #e0e7ff 45%, #eaf2ff 100%)",
          ].join(", "),
          backgroundRepeat: "no-repeat",
          backgroundSize: "200% 200%",
          animation: "moziBgDrift 60s ease-in-out infinite",
          display: "flex",
          justifyContent: "center",
          padding: "32px 16px",
          color: COLORS.text,
          fontFamily: "system-ui",
        }}
      >
        <style>{`
          @keyframes moziBgDrift {
            0%   { background-position: 50% 0%, 0% 30%, 0% 0%; }
            50%  { background-position: 60% 12%, 15% 40%, 0% 0%; }
            100% { background-position: 50% 0%, 0% 30%, 0% 0%; }
          }
        `}</style>

        <main style={{ maxWidth: 900, width: "100%", padding: 24 }}>
          <header
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto 1fr",
              alignItems: "center",
              marginBottom: 24,
            }}
          >
            <div>
              <Link href="/locations" style={btnSoft(false)}>
                ← Locations
              </Link>
            </div>

            <h1
              style={{
                fontSize: 30,
                fontWeight: 950,
                letterSpacing: -0.4,
                margin: 0,
                textAlign: "center",
              }}
            >
              Location
            </h1>

            <div />
          </header>

          <section
            style={{
              ...cardStyle,
              border: `1px solid ${COLORS.dangerBorder}`,
              background: COLORS.dangerBg,
              color: COLORS.dangerText,
              fontWeight: 800,
            }}
          >
            Missing locationId in route params.
          </section>
        </main>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        width: "100%",
        backgroundColor: "#dbeafe",
        backgroundImage: [
          "radial-gradient(1400px 750px at 50% -220px, rgba(37,99,235,0.35) 0%, rgba(37,99,235,0.18) 42%, rgba(219,234,254,0) 75%)",
          "radial-gradient(1100px 650px at 15% 25%, rgba(59,130,246,0.22) 0%, rgba(219,234,254,0) 62%)",
          "linear-gradient(180deg, #dbeafe 0%, #e0e7ff 45%, #eaf2ff 100%)",
        ].join(", "),
        backgroundRepeat: "no-repeat",
        backgroundSize: "200% 200%",
        animation: "moziBgDrift 60s ease-in-out infinite",
        display: "flex",
        justifyContent: "center",
        padding: "32px 16px",
        color: COLORS.text,
        fontFamily: "system-ui",
      }}
    >
      <style>{`
        @keyframes moziBgDrift {
          0%   { background-position: 50% 0%, 0% 30%, 0% 0%; }
          50%  { background-position: 60% 12%, 15% 40%, 0% 0%; }
          100% { background-position: 50% 0%, 0% 30%, 0% 0%; }
        }
      `}</style>

      <main style={{ maxWidth: 900, width: "100%", padding: 24 }}>
        {/* Header */}
        <header
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto 1fr",
            alignItems: "center",
            marginBottom: 24,
          }}
        >
          <div style={{ display: "flex", gap: 10 }}>
            <Link href="/locations" style={btnSoft(false)}>
              ← Locations
            </Link>
          </div>

          <div style={{ textAlign: "center" }}>
            <div
              style={{
                fontSize: 30,
                fontWeight: 950,
                letterSpacing: -0.4,
                margin: 0,
              }}
            >
              Location
            </div>
            <div
              style={{ marginTop: 6, color: COLORS.subtext, fontWeight: 800 }}
            >
              {shortenId(locationId)}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <Link
              href={`/locations/${locationId}/inventory`}
              style={btnSoft(false)}
            >
              Inventory
            </Link>
          </div>
        </header>

        {/* Controls */}
        <section style={cardStyle}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div style={{ fontWeight: 950 }}>Generate purchase plan</div>
            <div style={{ color: COLORS.subtext, fontWeight: 800 }}>
              Deterministic controls → /api/plan
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
            }}
          >
            <div style={{ display: "grid", gap: 6 }}>
              <label style={{ fontWeight: 900, color: COLORS.subtext }}>
                Strategy
              </label>
              <select
                value={strategy}
                onChange={(e) =>
                  setStrategy(
                    e.target.value as PlanInput["ownerPrefs"]["strategy"]
                  )
                }
                style={{
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: `1px solid ${COLORS.border}`,
                  background: "rgba(255,255,255,0.85)",
                  color: COLORS.text,
                  fontWeight: 800,
                  outline: "none",
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
              <label style={{ fontWeight: 900, color: COLORS.subtext }}>
                Planning horizon (days)
              </label>
              <input
                type="number"
                min={1}
                max={30}
                value={horizonDays}
                onChange={(e) => setHorizonDays(Number(e.target.value))}
                style={{
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: `1px solid ${COLORS.border}`,
                  background: "rgba(255,255,255,0.85)",
                  color: COLORS.text,
                  fontWeight: 800,
                  outline: "none",
                }}
              />
            </div>

            <div style={{ display: "grid", gap: 6, gridColumn: "1 / -1" }}>
              <label style={{ fontWeight: 900, color: COLORS.subtext }}>
                Notes (context)
              </label>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder='e.g. "Football weekend"'
                style={{
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: `1px solid ${COLORS.border}`,
                  background: "rgba(255,255,255,0.85)",
                  color: COLORS.text,
                  fontWeight: 800,
                  outline: "none",
                }}
              />
            </div>
          </div>

          <div
            style={{
              display: "flex",
              gap: 10,
              alignItems: "center",
              justifyContent: "flex-end",
              flexWrap: "wrap",
              paddingTop: 4,
            }}
          >
            <button
              onClick={generate}
              disabled={loading}
              style={btnPrimary(loading)}
            >
              {loading ? "Generating…" : "Generate Plan"}
            </button>
          </div>
        </section>

        {/* Error */}
        {error ? (
          <section
            style={{
              ...cardStyle,
              border: `1px solid ${COLORS.dangerBorder}`,
              background: COLORS.dangerBg,
              color: COLORS.dangerText,
              fontWeight: 800,
              whiteSpace: "pre-wrap",
            }}
          >
            {error}
          </section>
        ) : plan ? (
          <div style={{ marginTop: 16, display: "grid", gap: 16 }}>
            {/* Summary */}
            <section style={cardStyle}>
              <div style={{ fontWeight: 950, fontSize: 18 }}>Purchase Plan</div>
              <div style={{ color: COLORS.subtext, fontWeight: 800 }}>
                Generated: {plan.generatedAt} • Horizon: {plan.horizonDays} days
              </div>

              {plan.summary?.keyDrivers?.length ? (
                <div style={{ marginTop: 6 }}>
                  <div style={{ fontWeight: 900 }}>Key drivers</div>
                  <ul style={{ marginTop: 8, color: COLORS.text }}>
                    {plan.summary.keyDrivers.map((d, i) => (
                      <li key={i} style={{ marginTop: 6 }}>
                        {d}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {plan.summary?.warnings?.length ? (
                <div
                  style={{
                    marginTop: 8,
                    padding: 12,
                    borderRadius: 12,
                    border: `1px solid ${COLORS.warnBorder}`,
                    background: COLORS.warnBg,
                    color: COLORS.warnText,
                  }}
                >
                  <div style={{ fontWeight: 900 }}>Warnings</div>
                  <ul style={{ marginTop: 8 }}>
                    {plan.summary.warnings.map((w, i) => (
                      <li key={i} style={{ marginTop: 6 }}>
                        {w}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>

            {paymentIntent ? (
              <section style={{ ...cardStyle, whiteSpace: "pre-wrap" }}>
                <div style={{ fontWeight: 950 }}>Payment Intent (debug)</div>
                <pre style={{ margin: 0, fontSize: 12 }}>
                  {JSON.stringify(paymentIntent, null, 2)}
                </pre>
              </section>
            ) : null}

            {executeResp ? (
              <section style={{ ...cardStyle, whiteSpace: "pre-wrap" }}>
                <div style={{ fontWeight: 950 }}>Execute Response (debug)</div>
                <pre style={{ margin: 0, fontSize: 12 }}>
                  {JSON.stringify(executeResp, null, 2)}
                </pre>
              </section>
            ) : null}

            {/* Orders */}
            {plan.orders.map((order, idx) => (
              <section key={idx} style={cardStyle}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    flexWrap: "wrap",
                    alignItems: "baseline",
                  }}
                >
                  <div style={{ fontWeight: 950 }}>
                    Supplier:{" "}
                    <span
                      style={{ fontFamily: "ui-monospace, Menlo, monospace" }}
                    >
                      {order.supplierId}
                    </span>
                  </div>
                  <div style={{ color: COLORS.subtext, fontWeight: 800 }}>
                    Order date: {order.orderDate}
                  </div>
                </div>

                <div
                  style={{
                    marginTop: 10,
                    overflowX: "auto",
                    border: `1px solid ${COLORS.border}`,
                    borderRadius: 12,
                    background: "rgba(255,255,255,0.75)",
                  }}
                >
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        <th
                          style={{
                            textAlign: "left",
                            padding: 12,
                            fontWeight: 950,
                          }}
                        >
                          SKU
                        </th>
                        <th
                          style={{
                            textAlign: "right",
                            padding: 12,
                            fontWeight: 950,
                          }}
                        >
                          Units
                        </th>
                        <th
                          style={{
                            textAlign: "left",
                            padding: 12,
                            fontWeight: 950,
                          }}
                        >
                          Risk
                        </th>
                        <th
                          style={{
                            textAlign: "right",
                            padding: 12,
                            fontWeight: 950,
                          }}
                        >
                          Conf.
                        </th>
                        <th
                          style={{
                            textAlign: "left",
                            padding: 12,
                            fontWeight: 950,
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
                              padding: 12,
                              borderTop: "1px solid #eef2f7",
                            }}
                          >
                            {it.sku}
                          </td>
                          <td
                            style={{
                              padding: 12,
                              borderTop: "1px solid #eef2f7",
                              textAlign: "right",
                              fontWeight: 900,
                            }}
                          >
                            {it.orderUnits}
                          </td>
                          <td
                            style={{
                              padding: 12,
                              borderTop: "1px solid #eef2f7",
                            }}
                          >
                            {it.riskNote ?? "—"}
                          </td>
                          <td
                            style={{
                              padding: 12,
                              borderTop: "1px solid #eef2f7",
                              textAlign: "right",
                            }}
                          >
                            {typeof it.confidence === "number"
                              ? it.confidence.toFixed(2)
                              : "—"}
                          </td>
                          <td
                            style={{
                              padding: 12,
                              borderTop: "1px solid #eef2f7",
                            }}
                          >
                            {it.reason}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </div>
        ) : (
          <section
            style={{
              ...cardStyle,
              border: `1px solid ${COLORS.greenBorder}`,
              background: COLORS.greenBg,
              color: COLORS.greenText,
              fontWeight: 900,
            }}
          >
            No output yet — generate a plan to see proposed orders.
          </section>
        )}
      </main>
    </div>
  );
}
