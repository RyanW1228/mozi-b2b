// src/app/locations/[locationId]/inventory/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

type InventoryRow = {
  sku: string;
  onHandUnits: number;
};

type SkuMeta = {
  priceUsd: number;
  avgDailyConsumption: number;
  useByDays: number;
  supplier: string;

  // NOTE: you said Name already exists elsewhere.
  // We keep Name UI but do NOT store it in meta anymore.
  // If you already have a name source from backend, wire it here.
  // For now, we keep a local draftName just for display/edit UX.
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

function normalizeSku(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function sanitizeUnitsDraft(input: string) {
  return input.replace(/[^\d]/g, "");
}

function draftToNonNegInt(draft: string) {
  if (!draft) return 0;
  const n = parseInt(draft, 10);
  if (!Number.isFinite(n) || Number.isNaN(n)) return 0;
  return Math.max(0, Math.floor(n));
}

function sanitizeText(input: string) {
  return input.trim();
}

function sanitizeNumberDraft(input: string) {
  const cleaned = input.replace(/[^\d.]/g, "");
  const parts = cleaned.split(".");
  if (parts.length <= 1) return cleaned;
  return `${parts[0]}.${parts.slice(1).join("")}`;
}

function draftToNonNegFloat(draft: string) {
  if (!draft) return 0;
  const n = Number(draft);
  if (!Number.isFinite(n) || Number.isNaN(n)) return 0;
  return Math.max(0, n);
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
  const [ownerAddress, setOwnerAddress] = useState<string>("");
  const [incomingBySku, setIncomingBySku] = useState<Record<string, number>>(
    {}
  );

  const [loading, setLoading] = useState(false);
  const [savingSku, setSavingSku] = useState<string | null>(null);

  // drafts for smooth typing
  const [draftUnits, setDraftUnits] = useState<Record<string, string>>({});
  const [metaBySku, setMetaBySku] = useState<Record<string, SkuMeta>>({});
  const [draftPrice, setDraftPrice] = useState<Record<string, string>>({});
  const [draftAvg, setDraftAvg] = useState<Record<string, string>>({});
  const [draftUseBy, setDraftUseBy] = useState<Record<string, string>>({});
  const [draftSupplier, setDraftSupplier] = useState<Record<string, string>>(
    {}
  );

  // which SKUs are in "editing" mode (view-only unless editing)
  const [editingSku, setEditingSku] = useState<Record<string, boolean>>({});

  const [msg, setMsg] = useState<string>("");
  const [msgKind, setMsgKind] = useState<"success" | "error" | "warn" | "">("");

  const [showAddItem, setShowAddItem] = useState(false);

  const [newSku, setNewSku] = useState("");
  const [newUnitsDraft, setNewUnitsDraft] = useState<string>("0");

  const [newPriceDraft, setNewPriceDraft] = useState("0");
  const [newUseByDraft, setNewUseByDraft] = useState("0");
  const [newSupplier, setNewSupplier] = useState("");
  const [newAvgDraft, setNewAvgDraft] = useState("0");

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

  const btnDangerSoft = (disabled?: boolean): React.CSSProperties => ({
    padding: "8px 10px",
    borderRadius: 10,
    border: `1px solid ${COLORS.dangerBorder}`,
    background: COLORS.dangerBg,
    color: COLORS.dangerText,
    fontWeight: 900,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.65 : 1,
  });

  const btnGraySoft = (disabled?: boolean): React.CSSProperties => ({
    padding: "8px 10px",
    borderRadius: 10,
    border: `1px solid ${COLORS.border}`,
    background: "rgba(255,255,255,0.75)",
    color: COLORS.text,
    fontWeight: 900,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.65 : 1,
  });

  const inputStyle: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 12,
    border: `1px solid ${COLORS.border}`,
    background: "rgba(255,255,255,0.85)",
    color: COLORS.text,
    fontWeight: 800,
    outline: "none",
    width: 140,
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

  function InfoBubble({ text }: { text: string }) {
    return (
      <span
        style={{
          position: "relative",
          display: "inline-flex",
          alignItems: "center",
        }}
      >
        <span
          tabIndex={0}
          aria-label="Info"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 16,
            height: 16,
            borderRadius: "50%",
            border: `1px solid ${COLORS.border}`,
            fontSize: 11,
            fontWeight: 900,
            color: COLORS.subtext,
            cursor: "help",
            userSelect: "none",
            background: "rgba(255,255,255,0.85)",
          }}
        >
          ?
        </span>

        {/* Tooltip */}
        <span
          className="moziInfoTooltip"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 8px)",
            width: 320,
            padding: "10px 12px",
            borderRadius: 12,
            border: `1px solid ${COLORS.border}`,
            background: "white",
            color: COLORS.text,
            fontSize: 12,
            fontWeight: 800,
            boxShadow: "0 10px 25px rgba(15, 23, 42, 0.12)",
            opacity: 0,
            transform: "translateY(-4px)",
            pointerEvents: "none",
            zIndex: 50,
            whiteSpace: "normal",
          }}
        >
          {text}
        </span>
      </span>
    );
  }

  function setMessage(kind: "success" | "error" | "warn", text: string) {
    setMsgKind(kind);
    setMsg(text);
  }

  async function fetchMeta() {
    if (!locationId)
      return { ok: false, metaBySku: {} as Record<string, SkuMeta> };
    const res = await fetch(
      `/api/inventory/meta?locationId=${encodeURIComponent(locationId)}`,
      { method: "GET", cache: "no-store" }
    );

    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      return { ok: false, metaBySku: {} as Record<string, SkuMeta> };
    }
    return {
      ok: true,
      metaBySku: (json.metaBySku ?? {}) as Record<string, SkuMeta>,
    };
  }

  async function saveMetaForSku(sku: string, meta: SkuMeta) {
    if (!locationId) return;
    const res = await fetch(
      `/api/inventory/meta?locationId=${encodeURIComponent(locationId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku, meta }),
      }
    );
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      throw new Error(
        `META HTTP ${res.status}\n` + JSON.stringify(json, null, 2)
      );
    }
  }

  async function deleteMetaForSku(sku: string) {
    if (!locationId) return;
    const res = await fetch(
      `/api/inventory/meta?locationId=${encodeURIComponent(locationId)}`,
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku }),
      }
    );
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      throw new Error(
        `META HTTP ${res.status}\n` + JSON.stringify(json, null, 2)
      );
    }
  }

  async function refresh() {
    if (!locationId) return;
    setLoading(true);
    setMsg("");
    setMsgKind("");

    try {
      const [invRes, metaRes] = await Promise.all([
        fetch(`/api/inventory?locationId=${encodeURIComponent(locationId)}`, {
          cache: "no-store",
        }),
        fetchMeta(),
      ]);

      const invJson = await invRes.json().catch(() => null);
      if (!invRes.ok) {
        setRows([]);
        setMessage("error", JSON.stringify(invJson, null, 2));
        return;
      }

      const next = (invJson ?? []) as InventoryRow[];
      setRows(next);

      setDraftUnits(
        Object.fromEntries(next.map((r) => [r.sku, String(r.onHandUnits ?? 0)]))
      );

      const allMeta = (metaRes as any)?.metaBySku ?? {};
      setMetaBySku(allMeta);

      setDraftPrice(
        Object.fromEntries(
          next.map((r) => [r.sku, String(allMeta[r.sku]?.priceUsd ?? 0)])
        )
      );
      setDraftAvg(
        Object.fromEntries(
          next.map((r) => [
            r.sku,
            String(allMeta[r.sku]?.avgDailyConsumption ?? 0),
          ])
        )
      );
      setDraftUseBy(
        Object.fromEntries(
          next.map((r) => [r.sku, String(allMeta[r.sku]?.useByDays ?? 0)])
        )
      );
      setDraftSupplier(
        Object.fromEntries(
          next.map((r) => [r.sku, allMeta[r.sku]?.supplier ?? ""])
        )
      );

      // default: view-only for everything except on-hand
      setEditingSku((prev) => {
        const nextEditing = { ...prev };
        for (const r of next) {
          if (nextEditing[r.sku] === undefined) nextEditing[r.sku] = false;
        }
        return nextEditing;
      });

      if (!next?.length) {
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

    try {
      const res = await fetch(
        `/api/inventory?locationId=${encodeURIComponent(locationId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sku, onHandUnits }),
        }
      );

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setMessage("error", JSON.stringify(data, null, 2));
        return;
      }
    } catch (e: any) {
      setMessage("error", String(e));
    } finally {
      setSavingSku(null);
    }
  }

  async function deleteRow(sku: string) {
    if (!locationId) return;

    const prevRows = rows;
    const prevDraftUnits = draftUnits;
    const prevMeta = metaBySku;
    const prevEditing = editingSku;

    setRows((prev) => prev.filter((r) => r.sku !== sku));
    setDraftUnits((prev) => {
      const next = { ...prev };
      delete next[sku];
      return next;
    });
    setMetaBySku((prev) => {
      const next = { ...prev };
      delete next[sku];
      return next;
    });
    setEditingSku((prev) => {
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

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        // rollback
        setRows(prevRows);
        setDraftUnits(prevDraftUnits);
        setMetaBySku(prevMeta);
        setEditingSku(prevEditing);
        setMessage("error", JSON.stringify(data, null, 2));
        return;
      }

      try {
        await deleteMetaForSku(sku);
      } catch {}

      setMessage("success", `Deleted ${sku}.`);
    } catch (e: any) {
      setRows(prevRows);
      setDraftUnits(prevDraftUnits);
      setMetaBySku(prevMeta);
      setEditingSku(prevEditing);
      setMessage("error", String(e));
    }
  }

  function addLocalRow() {
    const sku = normalizeSku(newSku);

    if (!sku)
      return setMessage(
        "warn",
        "SKU must contain at least one letter or number."
      );
    if (rows.some((r) => r.sku === sku))
      return setMessage("warn", `SKU "${sku}" already exists.`);

    const supplier = sanitizeText(newSupplier);
    if (!supplier)
      return setMessage("warn", "Please enter a Supplier for this SKU.");

    const units = draftToNonNegInt(newUnitsDraft);
    const priceUsd = draftToNonNegFloat(newPriceDraft);
    const useByDays = draftToNonNegInt(newUseByDraft);
    const avgDailyConsumption = draftToNonNegFloat(newAvgDraft);

    setRows((prev) => [{ sku, onHandUnits: units }, ...prev]);
    setDraftUnits((prev) => ({ ...prev, [sku]: String(units) }));

    const meta: SkuMeta = {
      supplier,
      priceUsd,
      avgDailyConsumption,
      useByDays,
    };

    setMetaBySku((prev) => ({ ...prev, [sku]: meta }));
    setDraftSupplier((p) => ({ ...p, [sku]: supplier }));
    setDraftPrice((p) => ({ ...p, [sku]: String(priceUsd) }));
    setDraftAvg((p) => ({ ...p, [sku]: String(avgDailyConsumption) }));
    setDraftUseBy((p) => ({ ...p, [sku]: String(useByDays) }));

    // NEW: after adding, view-only by default (except On hand is always editable)
    setEditingSku((p) => ({ ...p, [sku]: false }));

    setNewSku("");
    setNewUnitsDraft("0");
    setNewPriceDraft("0");
    setNewAvgDraft("0");
    setNewUseByDraft("0");
    setNewSupplier("");

    setShowAddItem(false);
    setMessage("success", `Added ${sku}. Click Save to persist.`);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId]);

  if (!locationId) {
    return (
      <div style={{ padding: 24, color: COLORS.text, fontFamily: "system-ui" }}>
        Missing locationId in route params.
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

  /* Tooltip show behavior */
  span:hover > .moziInfoTooltip,
  span:focus-within > .moziInfoTooltip {
    opacity: 1 !important;
    transform: translateY(0) !important;
  }
`}</style>

      <main style={{ maxWidth: 1100, width: "100%", padding: 24 }}>
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
              Dashboard
            </Link>
          </div>

          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 30, fontWeight: 950, letterSpacing: -0.4 }}>
              Inventory
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <Link
              href={`/locations/${locationId}/suppliers`}
              style={btnSoft(false)}
            >
              Suppliers
            </Link>
          </div>
        </header>

        {msg ? (
          <section style={{ ...cardStyle, ...msgStyle() }}>{msg}</section>
        ) : null}

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
            <div style={{ fontWeight: 950 }}>
              Inventory SKUs{" "}
              <InfoBubble text="A SKU (Stock Keeping Unit) is your unique internal identifier for an item (e.g., chicken_breast). It should be consistent so inventory and purchasing can track the same product over time." />
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                onClick={() => setShowAddItem((v) => !v)}
                style={btnSoft(false)}
              >
                + Add SKU
              </button>

              <button
                onClick={async () => {
                  setMsg("");
                  setMsgKind("");
                  try {
                    // 1) save counts
                    // 1) save counts (use draftUnits, not rows)
                    for (const r of rows) {
                      const sku = r.sku;
                      const normalizedOnHand = draftToNonNegInt(
                        draftUnits[sku] ?? String(r.onHandUnits ?? 0)
                      );

                      await saveRow(sku, normalizedOnHand);

                      // keep rows in sync so UI + future saves are correct
                      setRows((prev) =>
                        prev.map((x) =>
                          x.sku === sku
                            ? { ...x, onHandUnits: normalizedOnHand }
                            : x
                        )
                      );
                    }

                    // 2) save meta for any sku (supplier/price/avg/useby)
                    for (const r of rows) {
                      const sku = r.sku;
                      const meta: SkuMeta = {
                        supplier: sanitizeText(
                          draftSupplier[sku] ?? metaBySku[sku]?.supplier ?? ""
                        ),
                        priceUsd: draftToNonNegFloat(
                          draftPrice[sku] ??
                            String(metaBySku[sku]?.priceUsd ?? 0)
                        ),
                        avgDailyConsumption: draftToNonNegFloat(
                          draftAvg[sku] ??
                            String(metaBySku[sku]?.avgDailyConsumption ?? 0)
                        ),
                        useByDays: draftToNonNegInt(
                          draftUseBy[sku] ??
                            String(metaBySku[sku]?.useByDays ?? 0)
                        ),
                      };

                      if (!meta.supplier) {
                        throw new Error(`Supplier is required for ${sku}.`);
                      }

                      await saveMetaForSku(sku, meta);
                      setMetaBySku((prev) => ({ ...prev, [sku]: meta }));
                    }

                    // lock all rows after saving
                    setEditingSku((prev) => {
                      const next: Record<string, boolean> = { ...prev };
                      for (const r of rows) next[r.sku] = false;
                      return next;
                    });

                    setMessage("success", "Saved.");
                  } catch (e: any) {
                    setMessage("error", String(e?.message ?? e));
                  }
                }}
                disabled={loading || rows.length === 0 || !!savingSku}
                style={btnPrimary(loading || rows.length === 0 || !!savingSku)}
              >
                Save
              </button>
            </div>
          </div>

          {showAddItem && (
            <div
              style={{
                border: `1px solid ${COLORS.border}`,
                borderRadius: 12,
                padding: 12,
                background: "rgba(255,255,255,0.75)",
                display: "flex",
                flexWrap: "wrap",
                gap: 10,
                alignItems: "flex-end",
              }}
            >
              {/* SKU */}
              <div style={{ display: "grid", gap: 6, minWidth: 220 }}>
                <div
                  style={{
                    fontWeight: 950,
                    color: COLORS.subtext,
                    fontSize: 12,
                  }}
                >
                  SKU
                </div>
                <input
                  value={newSku}
                  onChange={(e) => setNewSku(e.target.value)}
                  placeholder="e.g., chicken_breast"
                  style={{ ...inputStyle, width: "100%" }}
                />
              </div>

              {/* On hand */}
              <div style={{ display: "grid", gap: 6, width: 120 }}>
                <div
                  style={{
                    fontWeight: 950,
                    color: COLORS.subtext,
                    fontSize: 12,
                  }}
                >
                  On hand
                </div>
                <input
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={newUnitsDraft}
                  onChange={(e) =>
                    setNewUnitsDraft(sanitizeUnitsDraft(e.target.value))
                  }
                  onBlur={() =>
                    setNewUnitsDraft(String(draftToNonNegInt(newUnitsDraft)))
                  }
                  placeholder="0"
                  style={{ ...inputStyle, width: "100%", textAlign: "right" }}
                />
              </div>

              {/* Price */}
              <div style={{ display: "grid", gap: 6, width: 140 }}>
                <div
                  style={{
                    fontWeight: 950,
                    color: COLORS.subtext,
                    fontSize: 12,
                  }}
                >
                  Price (USD)
                </div>
                <input
                  inputMode="decimal"
                  value={newPriceDraft}
                  onChange={(e) =>
                    setNewPriceDraft(sanitizeNumberDraft(e.target.value))
                  }
                  onBlur={() =>
                    setNewPriceDraft(String(draftToNonNegFloat(newPriceDraft)))
                  }
                  placeholder="0"
                  style={{ ...inputStyle, width: "100%", textAlign: "right" }}
                />
              </div>

              {/* Daily Usage */}
              <div style={{ display: "grid", gap: 6, width: 170 }}>
                <div
                  style={{
                    fontWeight: 950,
                    color: COLORS.subtext,
                    fontSize: 12,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  Daily Usage
                </div>

                <input
                  inputMode="decimal"
                  value={newAvgDraft}
                  onChange={(e) =>
                    setNewAvgDraft(sanitizeNumberDraft(e.target.value))
                  }
                  onBlur={() =>
                    setNewAvgDraft(String(draftToNonNegFloat(newAvgDraft)))
                  }
                  placeholder="0"
                  style={{ ...inputStyle, width: "100%", textAlign: "right" }}
                />
              </div>

              {/* Use-by */}
              <div style={{ display: "grid", gap: 6, width: 150 }}>
                <div
                  style={{
                    fontWeight: 950,
                    color: COLORS.subtext,
                    fontSize: 12,
                  }}
                >
                  Shelf Life
                </div>
                <input
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={newUseByDraft}
                  onChange={(e) =>
                    setNewUseByDraft(sanitizeUnitsDraft(e.target.value))
                  }
                  onBlur={() =>
                    setNewUseByDraft(String(draftToNonNegInt(newUseByDraft)))
                  }
                  placeholder="0"
                  style={{ ...inputStyle, width: "100%", textAlign: "right" }}
                />
              </div>

              {/* Supplier */}
              <div
                style={{
                  display: "grid",
                  gap: 6,
                  minWidth: 200,
                  flex: "1 1 200px",
                }}
              >
                <div
                  style={{
                    fontWeight: 950,
                    color: COLORS.subtext,
                    fontSize: 12,
                  }}
                >
                  Supplier
                </div>
                <input
                  value={newSupplier}
                  onChange={(e) => setNewSupplier(e.target.value)}
                  placeholder="e.g., Sysco"
                  style={{ ...inputStyle, width: "100%" }}
                />
              </div>

              {/* Buttons */}
              <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
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
            </div>
          )}

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th
                    style={{ textAlign: "left", padding: 10, fontWeight: 950 }}
                  >
                    SKU
                  </th>
                  <th
                    style={{ textAlign: "right", padding: 10, fontWeight: 950 }}
                  >
                    On hand
                  </th>
                  <th
                    style={{ textAlign: "right", padding: 10, fontWeight: 950 }}
                  >
                    Price
                  </th>
                  <th
                    style={{ textAlign: "right", padding: 10, fontWeight: 950 }}
                  >
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      Daily Usage
                    </span>
                  </th>

                  <th
                    style={{ textAlign: "right", padding: 10, fontWeight: 950 }}
                  >
                    Shelf Life
                  </th>
                  <th
                    style={{ textAlign: "left", padding: 10, fontWeight: 950 }}
                  >
                    Supplier
                  </th>
                  <th
                    style={{ textAlign: "right", padding: 10, fontWeight: 950 }}
                  >
                    Actions
                  </th>
                </tr>
              </thead>

              <tbody>
                {rows.map((r) => {
                  const isEditing = !!editingSku[r.sku];

                  const priceVal =
                    draftPrice[r.sku] ??
                    String(metaBySku[r.sku]?.priceUsd ?? 0);
                  const avgVal =
                    draftAvg[r.sku] ??
                    String(metaBySku[r.sku]?.avgDailyConsumption ?? 0);
                  const useByVal =
                    draftUseBy[r.sku] ??
                    String(metaBySku[r.sku]?.useByDays ?? 0);
                  const supplierVal =
                    draftSupplier[r.sku] ?? metaBySku[r.sku]?.supplier ?? "";

                  return (
                    <tr key={r.sku}>
                      <td
                        style={{ padding: 10, borderTop: "1px solid #eef2f7" }}
                      >
                        <span
                          style={{
                            fontFamily: "ui-monospace, Menlo, monospace",
                            fontWeight: 900,
                          }}
                        >
                          {r.sku}
                        </span>
                      </td>

                      {/* On hand: ALWAYS editable */}
                      <td
                        style={{
                          padding: 10,
                          borderTop: "1px solid #eef2f7",
                          textAlign: "right",
                        }}
                      >
                        <input
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={
                            draftUnits[r.sku] ?? String(r.onHandUnits ?? 0)
                          }
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
                          style={{
                            ...inputStyle,
                            width: 110,
                            textAlign: "right",
                          }}
                        />
                      </td>

                      {/* Price: view-only unless editing */}
                      <td
                        style={{
                          padding: 10,
                          borderTop: "1px solid #eef2f7",
                          textAlign: "right",
                        }}
                      >
                        {isEditing ? (
                          <input
                            inputMode="decimal"
                            value={priceVal}
                            onChange={(e) =>
                              setDraftPrice((p) => ({
                                ...p,
                                [r.sku]: sanitizeNumberDraft(e.target.value),
                              }))
                            }
                            onBlur={() => {
                              const n = draftToNonNegFloat(
                                draftPrice[r.sku] ?? ""
                              );
                              setDraftPrice((p) => ({
                                ...p,
                                [r.sku]: String(n),
                              }));
                            }}
                            style={{
                              ...inputStyle,
                              width: 120,
                              textAlign: "right",
                            }}
                          />
                        ) : (
                          <div style={{ fontWeight: 850 }}>
                            {Number(priceVal).toFixed(2)}
                          </div>
                        )}
                      </td>

                      {/* Avg/day: view-only unless editing */}
                      <td
                        style={{
                          padding: 10,
                          borderTop: "1px solid #eef2f7",
                          textAlign: "right",
                        }}
                      >
                        {isEditing ? (
                          <input
                            inputMode="decimal"
                            value={avgVal}
                            onChange={(e) =>
                              setDraftAvg((p) => ({
                                ...p,
                                [r.sku]: sanitizeNumberDraft(e.target.value),
                              }))
                            }
                            onBlur={() => {
                              const n = draftToNonNegFloat(
                                draftAvg[r.sku] ?? ""
                              );
                              setDraftAvg((p) => ({
                                ...p,
                                [r.sku]: String(n),
                              }));
                            }}
                            style={{
                              ...inputStyle,
                              width: 120,
                              textAlign: "right",
                            }}
                          />
                        ) : (
                          <div style={{ fontWeight: 850 }}>
                            {Number(avgVal) > 0
                              ? Number(avgVal).toFixed(2)
                              : "—"}
                          </div>
                        )}
                      </td>

                      {/* Use-by: view-only unless editing */}
                      <td
                        style={{
                          padding: 10,
                          borderTop: "1px solid #eef2f7",
                          textAlign: "right",
                        }}
                      >
                        {isEditing ? (
                          <input
                            inputMode="numeric"
                            pattern="[0-9]*"
                            value={useByVal}
                            onChange={(e) =>
                              setDraftUseBy((p) => ({
                                ...p,
                                [r.sku]: sanitizeUnitsDraft(e.target.value),
                              }))
                            }
                            onBlur={() => {
                              const n = draftToNonNegInt(
                                draftUseBy[r.sku] ?? ""
                              );
                              setDraftUseBy((p) => ({
                                ...p,
                                [r.sku]: String(n),
                              }));
                            }}
                            style={{
                              ...inputStyle,
                              width: 130,
                              textAlign: "right",
                            }}
                          />
                        ) : (
                          <div style={{ fontWeight: 850 }}>
                            {Number(useByVal) || 0}
                          </div>
                        )}
                      </td>

                      {/* Supplier: view-only unless editing */}
                      <td
                        style={{ padding: 10, borderTop: "1px solid #eef2f7" }}
                      >
                        {isEditing ? (
                          <input
                            value={supplierVal}
                            onChange={(e) =>
                              setDraftSupplier((p) => ({
                                ...p,
                                [r.sku]: e.target.value,
                              }))
                            }
                            placeholder="Supplier"
                            style={{ ...inputStyle, width: 180 }}
                          />
                        ) : (
                          <div style={{ fontWeight: 850 }}>
                            {supplierVal ? supplierVal : "—"}
                          </div>
                        )}
                      </td>

                      {/* Actions: Edit (left) then Delete */}
                      <td
                        style={{
                          padding: 10,
                          borderTop: "1px solid #eef2f7",
                          textAlign: "right",
                          whiteSpace: "nowrap",
                        }}
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setEditingSku((p) => ({ ...p, [r.sku]: !p[r.sku] }))
                          }
                          style={btnGraySoft(false)}
                        >
                          {isEditing ? "Done" : "Edit"}
                        </button>

                        <span style={{ display: "inline-block", width: 8 }} />

                        <button
                          type="button"
                          onClick={() => {
                            if (confirm(`Delete "${r.sku}"?`)) deleteRow(r.sku);
                          }}
                          style={btnDangerSoft(false)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}

                {!rows.length ? (
                  <tr>
                    <td
                      colSpan={7}
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
