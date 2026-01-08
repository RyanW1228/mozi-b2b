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
  // Draft text values for numeric inputs (so typing is smooth)
  const [draftUnits, setDraftUnits] = useState<Record<string, string>>({});

  const [msg, setMsg] = useState<string>("");
  const [msgKind, setMsgKind] = useState<"success" | "error" | "warn" | "">("");

  const [showHelp, setShowHelp] = useState(false);

  const [showAddItem, setShowAddItem] = useState(false);
  const [newSku, setNewSku] = useState("");
  const [newUnitsDraft, setNewUnitsDraft] = useState<string>("0");

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

      const next = data as InventoryRow[];
      setRows(next);
      setDraftUnits(
        Object.fromEntries(next.map((r) => [r.sku, String(r.onHandUnits ?? 0)]))
      );
      if (!(data as InventoryRow[])?.length) {
        setMessage("warn", "No inventory rows returned for this location yet.");
      }
    } catch (e: any) {
      setMessage("error", String(e));
    } finally {
      setLoading(false);
    }
  }

  function normalizeSku(input: string) {
    return (
      input
        .trim()
        .toLowerCase()
        // replace spaces and any non-alphanumeric chars with underscores
        .replace(/[^a-z0-9]+/g, "_")
        // remove leading/trailing underscores
        .replace(/^_+|_+$/g, "")
    );
  }

  function sanitizeUnitsDraft(input: string) {
    // keep only digits; allow empty while typing
    return input.replace(/[^\d]/g, "");
  }

  function draftToNonNegInt(draft: string) {
    if (!draft) return 0;
    // parse base-10, clamp to >= 0, force integer
    const n = parseInt(draft, 10);
    if (!Number.isFinite(n) || Number.isNaN(n)) return 0;
    return Math.max(0, Math.floor(n));
  }

  function addLocalRow() {
    const raw = newSku;
    const sku = normalizeSku(raw);

    if (!sku) {
      setMessage("warn", "SKU must contain at least one letter or number.");
      return;
    }

    // prevent duplicates
    const exists = rows.some((r) => r.sku === sku);
    if (exists) {
      setMessage("warn", `SKU "${sku}" already exists.`);
      return;
    }

    const units = draftToNonNegInt(newUnitsDraft);

    setRows((prev) => [{ sku, onHandUnits: units }, ...prev]);
    setDraftUnits((prev) => ({ ...prev, [sku]: String(units) }));

    setNewSku("");
    setNewUnitsDraft("0");
    setShowAddItem(false);
    setMessage("success", `Added ${sku}. Click Save to persist.`);
  }

  async function saveRow(sku: string, onHandUnits: number) {
    if (!locationId) return;

    setSavingSku(sku);

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

  async function deleteRow(sku: string) {
    if (!locationId) return;

    // Optimistic UI: remove locally first (no lag)
    const prevRows = rows;
    const prevDraft = draftUnits;

    setRows((prev) => prev.filter((r) => r.sku !== sku));
    setDraftUnits((prev) => {
      const next = { ...prev };
      delete next[sku];
      return next;
    });

    try {
      const res = await fetch(
        `/api/inventory?locationId=${encodeURIComponent(locationId)}`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sku }),
        }
      );

      // some APIs return 204 No Content; don't assume json always exists
      let data: any = null;
      try {
        data = await res.json();
      } catch {}

      if (!res.ok) {
        // rollback if server rejects
        setRows(prevRows);
        setDraftUnits(prevDraft);
        setMessage(
          "error",
          data
            ? JSON.stringify(data, null, 2)
            : `Failed to delete SKU "${sku}".`
        );
        return;
      }

      setMessage("success", `Deleted ${sku}.`);
    } catch (e: any) {
      // rollback on network error
      setRows(prevRows);
      setDraftUnits(prevDraft);
      setMessage("error", String(e));
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
            <div />
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
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ fontWeight: 950 }}>On-hand counts</div>

              {/* Help icon */}
              <button
                onClick={() => setShowHelp((v) => !v)}
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  border: `1px solid ${COLORS.border}`,
                  background: "rgba(255,255,255,0.9)",
                  color: COLORS.subtext,
                  fontWeight: 900,
                  cursor: "pointer",
                  lineHeight: "20px",
                  textAlign: "center",
                  padding: 0,
                }}
                aria-label="What is SKU and units?"
              >
                ?
              </button>
            </div>

            <button
              onClick={async () => {
                setMsg("");
                setMsgKind("");
                try {
                  for (const r of rows) {
                    await saveRow(r.sku, r.onHandUnits);
                  }
                  setMessage("success", "Saved all inventory updates.");
                } catch (e: any) {
                  setMessage("error", String(e));
                }
              }}
              disabled={loading || rows.length === 0}
              style={btnPrimary(loading || rows.length === 0)}
            >
              Save
            </button>
          </div>

          {showHelp && (
            <div
              style={{
                marginTop: 8,
                padding: 12,
                borderRadius: 12,
                background: "rgba(255,255,255,0.85)",
                border: `1px solid ${COLORS.border}`,
                color: COLORS.text,
                fontWeight: 800,
                fontSize: 14,
                lineHeight: 1.45,
              }}
            >
              <div>
                <strong>SKU</strong> (Stock Keeping Unit) is the unique
                identifier for each product you track in inventory (for example:{" "}
                <code>chicken_breast</code>,<code>romaine_lettuce</code>, or{" "}
                <code>coke_12oz</code>).
              </div>
              <div style={{ marginTop: 6 }}>
                <strong>Units</strong> represent how many physical items you
                currently have on hand for that SKU. A unit is whatever your
                restaurant uses to count that product — for example: individual
                items, packages, cases, or pounds — as defined in your inventory
                system.
              </div>
            </div>
          )}

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
                    style={{
                      textAlign: "right",
                      padding: "12px 6px", // tighter
                      fontWeight: 950,
                      width: 1, // shrink to content
                    }}
                  />
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
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={draftUnits[r.sku] ?? String(r.onHandUnits ?? 0)}
                        onChange={(e) => {
                          const cleaned = sanitizeUnitsDraft(e.target.value);
                          setDraftUnits((prev) => ({
                            ...prev,
                            [r.sku]: cleaned,
                          }));
                        }}
                        onBlur={() => {
                          const normalized = draftToNonNegInt(
                            draftUnits[r.sku] ?? ""
                          );
                          setRows((prev) =>
                            prev.map((x) =>
                              x.sku === r.sku
                                ? { ...x, onHandUnits: normalized }
                                : x
                            )
                          );
                          setDraftUnits((prev) => ({
                            ...prev,
                            [r.sku]: String(normalized),
                          }));
                        }}
                        onFocus={(e) => e.currentTarget.select()}
                        style={{
                          ...inputStyle,
                          width: 150, // easier to type
                          fontSize: 16, // nicer on mobile
                        }}
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
                        type="button"
                        onClick={() => {
                          if (confirm(`Delete "${r.sku}"?`)) deleteRow(r.sku);
                        }}
                        aria-label={`Delete ${r.sku}`}
                        title="Delete item"
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 10,
                          border: `1px solid ${COLORS.dangerBorder}`,
                          background: COLORS.dangerBg,
                          color: COLORS.dangerText,
                          fontWeight: 950,
                          cursor: "pointer",
                          lineHeight: "26px",
                          padding: 0,
                        }}
                        onMouseEnter={(e) => {
                          (
                            e.currentTarget as HTMLButtonElement
                          ).style.transform = "translateY(-1px)";
                        }}
                        onMouseLeave={(e) => {
                          (
                            e.currentTarget as HTMLButtonElement
                          ).style.transform = "translateY(0px)";
                        }}
                      >
                        ×
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
          {/* Add-item form (toggles when you click the +) */}
          {showAddItem && (
            <div
              style={{
                marginTop: 10,
                padding: 12,
                borderRadius: 12,
                border: `1px solid ${COLORS.border}`,
                background: "rgba(255,255,255,0.85)",
                display: "flex",
                gap: 10,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <div style={{ fontWeight: 900, color: COLORS.subtext }}>
                Add item
              </div>

              <input
                value={newSku}
                onChange={(e) => setNewSku(e.target.value)}
                placeholder="SKU (e.g., chicken_breast)"
                style={{
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: `1px solid ${COLORS.border}`,
                  background: "rgba(255,255,255,0.9)",
                  color: COLORS.text,
                  fontWeight: 800,
                  outline: "none",
                  minWidth: 240,
                }}
              />

              <input
                inputMode="numeric"
                pattern="[0-9]*"
                value={newUnitsDraft}
                onChange={(e) =>
                  setNewUnitsDraft(sanitizeUnitsDraft(e.target.value))
                }
                onBlur={() => {
                  const normalized = draftToNonNegInt(newUnitsDraft);
                  setNewUnitsDraft(String(normalized));
                }}
                onFocus={(e) => e.currentTarget.select()}
                style={{
                  ...inputStyle,
                  width: 150,
                  fontSize: 16,
                }}
              />

              <button
                type="button"
                onClick={addLocalRow}
                style={btnPrimary(false)}
              >
                Add
              </button>

              <button
                type="button"
                onClick={() => setShowAddItem(false)}
                style={btnSoft(false)}
              >
                Cancel
              </button>
            </div>
          )}

          {/* + Add Item (icon only, bottom-centered like Locations page) */}
          <div
            style={{
              marginTop: 16,
              display: "flex",
              justifyContent: "center",
            }}
          >
            <button
              type="button"
              onClick={() => setShowAddItem((v) => !v)}
              aria-label="Add inventory item"
              title="Add inventory item"
              style={{
                width: 56,
                height: 56,
                borderRadius: "50%",
                background: COLORS.primary, // solid circle
                border: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 4px 12px rgba(37,99,235,0.35)",
                transition: "transform 120ms ease, box-shadow 120ms ease",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.transform =
                  "translateY(-1px)";
                (e.currentTarget as HTMLButtonElement).style.boxShadow =
                  "0 10px 24px rgba(37,99,235,0.4)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.transform =
                  "translateY(0px)";
                (e.currentTarget as HTMLButtonElement).style.boxShadow =
                  "0 4px 12px rgba(37,99,235,0.35)";
              }}
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                style={{ display: "block" }}
              >
                <path
                  d="M12 5v14M5 12h14"
                  stroke="white"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
