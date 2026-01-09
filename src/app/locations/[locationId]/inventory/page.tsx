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
  name: string;
  priceUsd: number;
  avgDailyConsumption: number;
  useByDays: number;
  supplier: string;
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

function metaKey(locationId: string) {
  return `mozi:inventoryMeta:${locationId}`;
}

function loadAllMeta(locationId: string): Record<string, SkuMeta> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(metaKey(locationId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveAllMeta(locationId: string, meta: Record<string, SkuMeta>) {
  if (typeof window === "undefined") return;
  localStorage.setItem(metaKey(locationId), JSON.stringify(meta));
}

function shortenId(id: string) {
  if (!id) return "—";
  return id.length <= 14 ? id : `${id.slice(0, 8)}…${id.slice(-4)}`;
}

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
  const [loading, setLoading] = useState(false);
  const [savingSku, setSavingSku] = useState<string | null>(null);

  // Draft text values for inputs (smooth typing)
  const [draftUnits, setDraftUnits] = useState<Record<string, string>>({});
  const [metaBySku, setMetaBySku] = useState<Record<string, SkuMeta>>({});
  const [draftName, setDraftName] = useState<Record<string, string>>({});
  const [draftPrice, setDraftPrice] = useState<Record<string, string>>({});
  const [draftAvg, setDraftAvg] = useState<Record<string, string>>({});
  const [draftUseBy, setDraftUseBy] = useState<Record<string, string>>({});
  const [draftSupplier, setDraftSupplier] = useState<Record<string, string>>(
    {}
  );

  const [msg, setMsg] = useState<string>("");
  const [msgKind, setMsgKind] = useState<"success" | "error" | "warn" | "">("");

  const [showAddItem, setShowAddItem] = useState(false);

  const [newSku, setNewSku] = useState("");
  const [newUnitsDraft, setNewUnitsDraft] = useState<string>("0");
  const [newName, setNewName] = useState("");
  const [newPriceDraft, setNewPriceDraft] = useState("0");
  const [newAvgDraft, setNewAvgDraft] = useState("0");
  const [newUseByDraft, setNewUseByDraft] = useState("0");
  const [newSupplier, setNewSupplier] = useState("");

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

      // drafts for onHand
      setDraftUnits(
        Object.fromEntries(next.map((r) => [r.sku, String(r.onHandUnits ?? 0)]))
      );

      // load + seed meta drafts
      const allMeta = loadAllMeta(locationId);
      setMetaBySku(allMeta);

      setDraftName(
        Object.fromEntries(next.map((r) => [r.sku, allMeta[r.sku]?.name ?? ""]))
      );
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

      const data = await res.json();
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

    // optimistic UI
    const prevRows = rows;
    const prevDraftUnits = draftUnits;
    const prevMeta = metaBySku;

    setRows((prev) => prev.filter((r) => r.sku !== sku));
    setDraftUnits((prev) => {
      const next = { ...prev };
      delete next[sku];
      return next;
    });

    setMetaBySku((prev) => {
      const next = { ...prev };
      delete next[sku];
      saveAllMeta(locationId, next);
      return next;
    });

    setDraftName((prev) => {
      const n = { ...prev };
      delete n[sku];
      return n;
    });
    setDraftPrice((prev) => {
      const n = { ...prev };
      delete n[sku];
      return n;
    });
    setDraftAvg((prev) => {
      const n = { ...prev };
      delete n[sku];
      return n;
    });
    setDraftUseBy((prev) => {
      const n = { ...prev };
      delete n[sku];
      return n;
    });
    setDraftSupplier((prev) => {
      const n = { ...prev };
      delete n[sku];
      return n;
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

      let data: any = null;
      try {
        data = await res.json();
      } catch {}

      if (!res.ok) {
        // rollback
        setRows(prevRows);
        setDraftUnits(prevDraftUnits);
        setMetaBySku(prevMeta);
        saveAllMeta(locationId, prevMeta);

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
      setDraftUnits(prevDraftUnits);
      setMetaBySku(prevMeta);
      saveAllMeta(locationId, prevMeta);

      setMessage("error", String(e));
    }
  }

  function addLocalRow() {
    const sku = normalizeSku(newSku);

    if (!sku) {
      setMessage("warn", "SKU must contain at least one letter or number.");
      return;
    }
    if (rows.some((r) => r.sku === sku)) {
      setMessage("warn", `SKU "${sku}" already exists.`);
      return;
    }

    const name = sanitizeText(newName);
    const supplier = sanitizeText(newSupplier);

    if (!name) {
      setMessage("warn", "Please enter a Name for this SKU.");
      return;
    }
    if (!supplier) {
      setMessage("warn", "Please enter a Supplier for this SKU.");
      return;
    }

    const units = draftToNonNegInt(newUnitsDraft);
    const priceUsd = draftToNonNegFloat(newPriceDraft);
    const avgDailyConsumption = draftToNonNegFloat(newAvgDraft);
    const useByDays = draftToNonNegInt(newUseByDraft);

    // Add row
    setRows((prev) => [{ sku, onHandUnits: units }, ...prev]);
    setDraftUnits((prev) => ({ ...prev, [sku]: String(units) }));

    // Add meta (persist immediately to localStorage so it's "clearly stored")
    const newMeta: SkuMeta = {
      name,
      supplier,
      priceUsd,
      avgDailyConsumption,
      useByDays,
    };

    setMetaBySku((prev) => {
      const next = { ...prev, [sku]: newMeta };
      saveAllMeta(locationId, next);
      return next;
    });

    // seed drafts
    setDraftName((p) => ({ ...p, [sku]: name }));
    setDraftSupplier((p) => ({ ...p, [sku]: supplier }));
    setDraftPrice((p) => ({ ...p, [sku]: String(priceUsd) }));
    setDraftAvg((p) => ({ ...p, [sku]: String(avgDailyConsumption) }));
    setDraftUseBy((p) => ({ ...p, [sku]: String(useByDays) }));

    // reset add form
    setNewSku("");
    setNewUnitsDraft("0");
    setNewName("");
    setNewPriceDraft("0");
    setNewAvgDraft("0");
    setNewUseByDraft("0");
    setNewSupplier("");

    setShowAddItem(false);
    setMessage("success", `Added ${sku}. Click Save to persist counts.`);
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
    <div style={{ padding: 24, color: COLORS.text, fontFamily: "system-ui" }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <Link href={`/locations/${locationId}`} style={btnSoft(false)}>
          ← Purchase Plan
        </Link>

        <div style={{ fontSize: 26, fontWeight: 950 }}>Inventory</div>

        <button
          onClick={async () => {
            setMsg("");
            setMsgKind("");
            try {
              // 1) persist on-hand counts to API
              for (const r of rows) {
                await saveRow(r.sku, r.onHandUnits);
              }

              // 2) persist meta to localStorage
              const nextMeta: Record<string, SkuMeta> = { ...metaBySku };

              for (const r of rows) {
                const sku = r.sku;

                const name = sanitizeText(
                  draftName[sku] ?? nextMeta[sku]?.name ?? ""
                );
                const supplier = sanitizeText(
                  draftSupplier[sku] ?? nextMeta[sku]?.supplier ?? ""
                );

                const priceUsd = draftToNonNegFloat(
                  draftPrice[sku] ?? String(nextMeta[sku]?.priceUsd ?? 0)
                );
                const avgDailyConsumption = draftToNonNegFloat(
                  draftAvg[sku] ??
                    String(nextMeta[sku]?.avgDailyConsumption ?? 0)
                );
                const useByDays = draftToNonNegInt(
                  draftUseBy[sku] ?? String(nextMeta[sku]?.useByDays ?? 0)
                );

                nextMeta[sku] = {
                  name,
                  supplier,
                  priceUsd,
                  avgDailyConsumption,
                  useByDays,
                };
              }

              saveAllMeta(locationId, nextMeta);
              setMetaBySku(nextMeta);

              setMessage("success", "Saved inventory counts + SKU details.");
            } catch (e: any) {
              setMessage("error", String(e));
            }
          }}
          disabled={loading || rows.length === 0 || !!savingSku}
          style={btnPrimary(loading || rows.length === 0 || !!savingSku)}
        >
          Save
        </button>
      </header>

      {msg ? (
        <section style={{ ...cardStyle, ...msgStyle() }}>{msg}</section>
      ) : null}

      <section style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <div style={{ fontWeight: 950 }}>Inventory SKUs</div>
          <button
            type="button"
            onClick={() => setShowAddItem((v) => !v)}
            style={btnSoft(false)}
          >
            + Add SKU
          </button>
        </div>

        {showAddItem && (
          <div
            style={{
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
              alignItems: "center",
              border: `1px solid ${COLORS.border}`,
              borderRadius: 12,
              padding: 12,
              background: "rgba(255,255,255,0.75)",
            }}
          >
            <input
              value={newSku}
              onChange={(e) => setNewSku(e.target.value)}
              placeholder="SKU (e.g., chicken_breast)"
              style={{ ...inputStyle, width: 220 }}
            />

            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Name (e.g., Chicken Breast)"
              style={{ ...inputStyle, width: 240 }}
            />

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
              placeholder="On hand"
              style={{ ...inputStyle, width: 120 }}
            />

            <input
              inputMode="decimal"
              value={newPriceDraft}
              onChange={(e) =>
                setNewPriceDraft(sanitizeNumberDraft(e.target.value))
              }
              onBlur={() =>
                setNewPriceDraft(String(draftToNonNegFloat(newPriceDraft)))
              }
              placeholder="Price (USD)"
              style={{ ...inputStyle, width: 140 }}
            />

            <input
              inputMode="decimal"
              value={newAvgDraft}
              onChange={(e) =>
                setNewAvgDraft(sanitizeNumberDraft(e.target.value))
              }
              onBlur={() =>
                setNewAvgDraft(String(draftToNonNegFloat(newAvgDraft)))
              }
              placeholder="Avg/day"
              style={{ ...inputStyle, width: 130 }}
            />

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
              placeholder="Use-by (days)"
              style={{ ...inputStyle, width: 150 }}
            />

            <input
              value={newSupplier}
              onChange={(e) => setNewSupplier(e.target.value)}
              placeholder="Supplier"
              style={{ ...inputStyle, width: 200 }}
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

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: 10, fontWeight: 950 }}>
                  SKU
                </th>
                <th style={{ textAlign: "left", padding: 10, fontWeight: 950 }}>
                  Name
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
                  Avg/day
                </th>
                <th
                  style={{ textAlign: "right", padding: 10, fontWeight: 950 }}
                >
                  Use-by (days)
                </th>
                <th style={{ textAlign: "left", padding: 10, fontWeight: 950 }}>
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
              {rows.map((r) => (
                <tr key={r.sku}>
                  <td style={{ padding: 10, borderTop: "1px solid #eef2f7" }}>
                    <span
                      style={{
                        fontFamily: "ui-monospace, Menlo, monospace",
                        fontWeight: 900,
                      }}
                    >
                      {r.sku}
                    </span>
                  </td>

                  <td style={{ padding: 10, borderTop: "1px solid #eef2f7" }}>
                    <input
                      value={draftName[r.sku] ?? metaBySku[r.sku]?.name ?? ""}
                      onChange={(e) =>
                        setDraftName((p) => ({ ...p, [r.sku]: e.target.value }))
                      }
                      placeholder="Name"
                      style={{ ...inputStyle, width: 220 }}
                    />
                  </td>

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
                      style={{ ...inputStyle, width: 110, textAlign: "right" }}
                    />
                  </td>

                  <td
                    style={{
                      padding: 10,
                      borderTop: "1px solid #eef2f7",
                      textAlign: "right",
                    }}
                  >
                    <input
                      inputMode="decimal"
                      value={
                        draftPrice[r.sku] ??
                        String(metaBySku[r.sku]?.priceUsd ?? 0)
                      }
                      onChange={(e) => {
                        const cleaned = sanitizeNumberDraft(e.target.value);
                        setDraftPrice((p) => ({ ...p, [r.sku]: cleaned }));
                      }}
                      onBlur={() => {
                        const n = draftToNonNegFloat(draftPrice[r.sku] ?? "");
                        setDraftPrice((p) => ({ ...p, [r.sku]: String(n) }));
                      }}
                      style={{ ...inputStyle, width: 120, textAlign: "right" }}
                    />
                  </td>

                  <td
                    style={{
                      padding: 10,
                      borderTop: "1px solid #eef2f7",
                      textAlign: "right",
                    }}
                  >
                    <input
                      inputMode="decimal"
                      value={
                        draftAvg[r.sku] ??
                        String(metaBySku[r.sku]?.avgDailyConsumption ?? 0)
                      }
                      onChange={(e) => {
                        const cleaned = sanitizeNumberDraft(e.target.value);
                        setDraftAvg((p) => ({ ...p, [r.sku]: cleaned }));
                      }}
                      onBlur={() => {
                        const n = draftToNonNegFloat(draftAvg[r.sku] ?? "");
                        setDraftAvg((p) => ({ ...p, [r.sku]: String(n) }));
                      }}
                      style={{ ...inputStyle, width: 120, textAlign: "right" }}
                    />
                  </td>

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
                        draftUseBy[r.sku] ??
                        String(metaBySku[r.sku]?.useByDays ?? 0)
                      }
                      onChange={(e) => {
                        const cleaned = sanitizeUnitsDraft(e.target.value);
                        setDraftUseBy((p) => ({ ...p, [r.sku]: cleaned }));
                      }}
                      onBlur={() => {
                        const n = draftToNonNegInt(draftUseBy[r.sku] ?? "");
                        setDraftUseBy((p) => ({ ...p, [r.sku]: String(n) }));
                      }}
                      style={{ ...inputStyle, width: 130, textAlign: "right" }}
                    />
                  </td>

                  <td style={{ padding: 10, borderTop: "1px solid #eef2f7" }}>
                    <input
                      value={
                        draftSupplier[r.sku] ?? metaBySku[r.sku]?.supplier ?? ""
                      }
                      onChange={(e) =>
                        setDraftSupplier((p) => ({
                          ...p,
                          [r.sku]: e.target.value,
                        }))
                      }
                      placeholder="Supplier"
                      style={{ ...inputStyle, width: 180 }}
                    />
                  </td>

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
                      onClick={() => {
                        if (confirm(`Delete "${r.sku}"?`)) deleteRow(r.sku);
                      }}
                      style={{
                        padding: "8px 10px",
                        borderRadius: 10,
                        border: `1px solid ${COLORS.dangerBorder}`,
                        background: COLORS.dangerBg,
                        color: COLORS.dangerText,
                        fontWeight: 900,
                        cursor: "pointer",
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}

              {!rows.length ? (
                <tr>
                  <td
                    colSpan={8}
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

        <div style={{ color: COLORS.subtext, fontWeight: 800, fontSize: 13 }}>
          Note: SKU details (name, price, avg/day, use-by, supplier) are stored
          locally in your browser (localStorage) per location.
        </div>
      </section>
    </div>
  );
}
