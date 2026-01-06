// src/app/locations/[locationId]/inventory/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

type InventoryRow = {
  sku: string;
  onHandUnits: number;
};

const COLORS = {
  text: "#0f172a",
  subtext: "#64748b",
  card: "#ffffff",
  border: "#e5e7eb",

  primary: "#2563eb",
  buttonTextLight: "#ffffff",

  danger: "#dc2626",
  dangerText: "#991b1b",
  dangerBg: "#fef2f2",
  dangerBorder: "#fecaca",

  greenText: "#065f46",
  greenBg: "#f0fdf4",
  greenBorder: "#bbf7d0",

  warnText: "#92400e",
  warnBg: "#fffbeb",
  warnBorder: "#fde68a",
};

function shortenId(id: string) {
  if (!id) return "—";
  return id.length <= 14 ? id : `${id.slice(0, 8)}…${id.slice(-4)}`;
}

export default function InventoryPage() {
  const params = useParams<{ locationId: string }>();

  const locationId = useMemo(() => {
    const v = params?.locationId;
    if (typeof v === "string") return v;
    if (Array.isArray(v)) return v[0];
    return "";
  }, [params]);

  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingSku, setSavingSku] = useState<string | null>(null);

  const [msg, setMsg] = useState<string>("");
  const [msgKind, setMsgKind] = useState<"success" | "error" | "warn" | "">("");

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

  const inputStyle: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 12,
    border: `1px solid ${COLORS.border}`,
    background: "rgba(255,255,255,0.85)",
    color: COLORS.text,
    fontWeight: 800,
    outline: "none",
    width: 120,
    textAlign: "right",
    boxShadow: "inset 0 1px 2px rgba(0,0,0,0.04)",
  };

  const msgStyle = (): React.CSSProperties => {
    if (msgKind === "success")
      return {
        color: COLORS.greenText,
        background: COLORS.greenBg,
        border: `1px solid ${COLORS.greenBorder}`,
        padding: 10,
        borderRadius: 12,
        fontWeight: 800,
        whiteSpace: "pre-wrap",
      };
    if (msgKind === "warn")
      return {
        color: COLORS.warnText,
        background: COLORS.warnBg,
        border: `1px solid ${COLORS.warnBorder}`,
        padding: 10,
        borderRadius: 12,
        fontWeight: 800,
        whiteSpace: "pre-wrap",
      };
    if (msgKind === "error")
      return {
        color: COLORS.dangerText,
        background: COLORS.dangerBg,
        border: `1px solid ${COLORS.dangerBorder}`,
        padding: 10,
        borderRadius: 12,
        fontWeight: 800,
        whiteSpace: "pre-wrap",
      };
    return {};
  };

  function setMessage(kind: "success" | "error" | "warn", text: string) {
    setMsgKind(kind);
    setMsg(text);
  }

  async function refresh() {
    if (!locationId) return;
    setLoading(true);
    setMsg("");
    setMsgKind("");

    try {
      const res = await fetch(
        `/api/inventory?locationId=${encodeURIComponent(locationId)}`
      );
      const data = await res.json();

      if (!res.ok) {
        setRows([]);
        setMessage("error", JSON.stringify(data, null, 2));
        return;
      }

      setRows(data as InventoryRow[]);
      if (!(data as InventoryRow[])?.length) {
        setMessage("warn", "No inventory rows returned for this location yet.");
      }
    } catch (e: any) {
      setMessage("error", String(e));
    } finally {
      setLoading(false);
    }
  }

  async function saveRow(sku: string, onHandUnits: number) {
    if (!locationId) return;

    setSavingSku(sku);
    setMsg("");
    setMsgKind("");

    try {
      const res = await fetch(
        `/api/inventory?locationId=${encodeURIComponent(locationId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sku, onHandUnits }),
        }
      );

      const data = await res.json();
      if (!res.ok) {
        setMessage("error", JSON.stringify(data, null, 2));
        return;
      }

      setMessage("success", `Saved ${sku} • onHandUnits=${onHandUnits}`);
    } catch (e: any) {
      setMessage("error", String(e));
    } finally {
      setSavingSku(null);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId]);

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
              Inventory
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
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link href={`/locations/${locationId}`} style={btnSoft(false)}>
              ← Purchase Plan
            </Link>
            <Link href="/locations" style={btnSoft(false)}>
              Locations
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
              Inventory
            </div>
            <div
              style={{ marginTop: 6, color: COLORS.subtext, fontWeight: 800 }}
            >
              {shortenId(locationId)}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              onClick={refresh}
              disabled={loading}
              style={btnPrimary(loading)}
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </header>

        {/* Status */}
        {msg ? (
          <section style={{ ...cardStyle, ...msgStyle() }}>{msg}</section>
        ) : null}

        {/* Table */}
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
            <div style={{ fontWeight: 950 }}>On-hand counts</div>
            <div style={{ color: COLORS.subtext, fontWeight: 800 }}>
              Edit values and save per SKU
            </div>
          </div>

          <div
            style={{
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
                    style={{ textAlign: "left", padding: 12, fontWeight: 950 }}
                  >
                    SKU
                  </th>
                  <th
                    style={{ textAlign: "right", padding: 12, fontWeight: 950 }}
                  >
                    On Hand
                  </th>
                  <th
                    style={{ textAlign: "right", padding: 12, fontWeight: 950 }}
                  >
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.sku}>
                    <td style={{ padding: 12, borderTop: "1px solid #eef2f7" }}>
                      <span
                        style={{
                          fontFamily: "ui-monospace, Menlo, monospace",
                          fontWeight: 900,
                        }}
                      >
                        {r.sku}
                      </span>
                    </td>

                    <td
                      style={{
                        padding: 12,
                        borderTop: "1px solid #eef2f7",
                        textAlign: "right",
                      }}
                    >
                      <input
                        type="number"
                        value={r.onHandUnits}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setRows((prev) =>
                            prev.map((x) =>
                              x.sku === r.sku ? { ...x, onHandUnits: v } : x
                            )
                          );
                        }}
                        style={inputStyle}
                      />
                    </td>

                    <td
                      style={{
                        padding: 12,
                        borderTop: "1px solid #eef2f7",
                        textAlign: "right",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <button
                        onClick={() => saveRow(r.sku, r.onHandUnits)}
                        disabled={!!savingSku && savingSku !== r.sku}
                        style={{
                          ...btnSoft(!!savingSku && savingSku !== r.sku),
                          background: "rgba(255,255,255,0.85)",
                        }}
                      >
                        {savingSku === r.sku ? "Saving…" : "Save"}
                      </button>
                    </td>
                  </tr>
                ))}

                {!rows.length ? (
                  <tr>
                    <td
                      colSpan={3}
                      style={{
                        padding: 14,
                        color: COLORS.subtext,
                        fontWeight: 900,
                        borderTop: "1px solid #eef2f7",
                      }}
                    >
                      No SKUs returned yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
