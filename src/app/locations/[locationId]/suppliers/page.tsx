"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getAddress, isAddress, ZeroAddress } from "ethers";

type SupplierRow = {
  supplierId: string; // stable internal id
  name: string;
  payoutAddress: string;
  leadTimeDays: number;
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

function normalizeId(input: string) {
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

function isReasonableSupplierName(nameRaw: string) {
  const name = sanitizeText(nameRaw);

  // Conditions of "reasonable":
  // - 2..40 chars
  // - must include at least one letter
  // - only letters/numbers/spaces and these safe symbols: & . ' - ( )
  // - no leading/trailing punctuation, no double spaces
  // - not all caps longer than 6 chars (looks spammy)
  if (name.length < 2 || name.length > 40) {
    return { ok: false, reason: "Name must be 2–40 characters." };
  }

  if (!/[A-Za-z]/.test(name)) {
    return { ok: false, reason: "Name must include at least one letter." };
  }

  if (!/^[A-Za-z0-9&.\-'"() ]+$/.test(name)) {
    return {
      ok: false,
      reason: "Use only letters, numbers, spaces, and & . ' - ( )",
    };
  }

  if (/^\s|[&.\-'"() ]$/.test(name)) {
    return { ok: false, reason: "No leading/trailing punctuation or spaces." };
  }

  if (/\s{2,}/.test(name)) {
    return { ok: false, reason: "No double spaces." };
  }

  if (name.length > 6 && name === name.toUpperCase()) {
    return { ok: false, reason: "Avoid ALL CAPS names." };
  }

  return { ok: true, name };
}

function isValidEvmAddress(addrRaw: string) {
  const addr = sanitizeText(addrRaw);

  if (!addr) {
    return { ok: false, reason: "Wallet address is required." };
  }

  if (!isAddress(addr)) {
    return {
      ok: false,
      reason: "Wallet address must be a valid Ethereum address (0x...).",
    };
  }

  const checksum = getAddress(addr);

  if (checksum === ZeroAddress) {
    return { ok: false, reason: "Wallet address cannot be the zero address." };
  }

  return { ok: true, addr: checksum };
}

export default function SuppliersPage() {
  const params = useParams<{ locationId: string }>();

  const locationId = useMemo(() => {
    const v = params?.locationId;
    if (typeof v === "string") return v;
    if (Array.isArray(v)) return v[0];
    return "";
  }, [params]);

  const [rows, setRows] = useState<SupplierRow[]>([]);
  const [loading, setLoading] = useState(false);

  // drafts for smooth typing
  const [draftName, setDraftName] = useState<Record<string, string>>({});
  const [draftAddress, setDraftAddress] = useState<Record<string, string>>({});
  const [draftLead, setDraftLead] = useState<Record<string, string>>({});

  const [editingId, setEditingId] = useState<Record<string, boolean>>({});

  const [msg, setMsg] = useState<string>("");
  const [msgKind, setMsgKind] = useState<"success" | "error" | "warn" | "">("");

  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newWallet, setNewWallet] = useState("");
  const [newLeadDraft, setNewLeadDraft] = useState("0");

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
    width: 180,
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

  // NOTE: UI-only refresh. Wire to backend later.
  async function refresh() {
    if (!locationId) return;

    setLoading(true);
    setMsg("");
    setMsgKind("");

    try {
      const res = await fetch(
        `/api/suppliers?locationId=${encodeURIComponent(locationId)}`,
        { cache: "no-store" }
      );
      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setRows([]);
        setMessage("error", JSON.stringify(json, null, 2));
        return;
      }

      const next = (json.suppliers ?? []) as SupplierRow[];
      setRows(next);

      // Initialize drafts from server data
      setDraftName(Object.fromEntries(next.map((s) => [s.supplierId, s.name])));
      setDraftAddress(
        Object.fromEntries(next.map((s) => [s.supplierId, s.payoutAddress]))
      );
      setDraftLead(
        Object.fromEntries(
          next.map((s) => [s.supplierId, String(s.leadTimeDays)])
        )
      );

      // Default: view-only
      setEditingId((prev) => {
        const n = { ...prev };
        for (const s of next) {
          if (n[s.supplierId] === undefined) n[s.supplierId] = false;
        }
        return n;
      });

      if (!next.length) setMessage("warn", "No suppliers returned yet.");
    } catch (e: any) {
      setMessage("error", String(e));
    } finally {
      setLoading(false);
    }
  }

  function addLocalSupplier() {
    const name = sanitizeText(newName);
    const payoutAddress = sanitizeText(newWallet);
    const leadTimeDays = draftToNonNegInt(newLeadDraft);

    if (!name) return setMessage("warn", "Please enter a Supplier Name.");
    if (!payoutAddress)
      return setMessage("warn", "Please enter a Wallet address.");

    const supplierId = normalizeId(name);
    if (!supplierId)
      return setMessage("warn", "Supplier Name must contain letters/numbers.");
    if (rows.some((r) => r.supplierId === supplierId)) {
      return setMessage("warn", `Supplier "${supplierId}" already exists.`);
    }

    const nextRow: SupplierRow = {
      supplierId,
      name,
      payoutAddress,
      leadTimeDays,
    };

    setRows((prev) => [nextRow, ...prev]);
    setDraftName((p) => ({ ...p, [supplierId]: name }));
    setDraftAddress((p) => ({ ...p, [supplierId]: payoutAddress }));
    setDraftLead((p) => ({ ...p, [supplierId]: String(leadTimeDays) }));
    setEditingId((p) => ({ ...p, [supplierId]: false }));

    setNewName("");
    setNewWallet("");
    setNewLeadDraft("0");
    setShowAdd(false);

    setMessage("success", `Added ${supplierId}. Click Save to persist.`);
  }

  async function deleteLocalSupplier(supplierId: string) {
    if (!locationId) return;

    const prevRows = rows;
    const prevDraftName = draftName;
    const prevDraftAddress = draftAddress;
    const prevDraftLead = draftLead;
    const prevEditing = editingId;

    // optimistic UI
    setRows((prev) => prev.filter((r) => r.supplierId !== supplierId));
    setDraftName((prev) => {
      const next = { ...prev };
      delete next[supplierId];
      return next;
    });
    setDraftAddress((prev) => {
      const next = { ...prev };
      delete next[supplierId];
      return next;
    });
    setDraftLead((prev) => {
      const next = { ...prev };
      delete next[supplierId];
      return next;
    });
    setEditingId((prev) => {
      const next = { ...prev };
      delete next[supplierId];
      return next;
    });

    try {
      const res = await fetch(
        `/api/suppliers?locationId=${encodeURIComponent(locationId)}`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ supplierId }),
        }
      );

      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        // rollback
        setRows(prevRows);
        setDraftName(prevDraftName);
        setDraftAddress(prevDraftAddress);
        setDraftLead(prevDraftLead);
        setEditingId(prevEditing);

        throw new Error(
          `SUPPLIERS HTTP ${res.status}\n` + JSON.stringify(json, null, 2)
        );
      }

      setMessage("success", `Deleted ${supplierId}.`);
    } catch (e: any) {
      setMessage("error", String(e?.message ?? e));
    }
  }

  async function saveAll() {
    if (!locationId) return;

    setMsg("");
    setMsgKind("");
    setLoading(true);

    try {
      for (const r of rows) {
        const supplierId = r.supplierId;

        const name = sanitizeText(draftName[supplierId] ?? "");
        const payoutAddress = sanitizeText(draftAddress[supplierId] ?? "");
        const leadTimeDays = draftToNonNegInt(draftLead[supplierId] ?? "0");

        if (!name)
          throw new Error(`Supplier name is required for ${supplierId}.`);
        if (!payoutAddress)
          throw new Error(`Wallet address is required for ${supplierId}.`);

        const res = await fetch(
          `/api/suppliers?locationId=${encodeURIComponent(locationId)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              supplierId,
              name,
              payoutAddress,
              leadTimeDays,
            }),
          }
        );

        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.ok) {
          throw new Error(
            `SUPPLIERS HTTP ${res.status}\n` + JSON.stringify(json, null, 2)
          );
        }

        // keep canonical rows synced with drafts
        setRows((prev) =>
          prev.map((x) =>
            x.supplierId === supplierId
              ? { ...x, name, payoutAddress, leadTimeDays }
              : x
          )
        );
      }

      // lock all rows after saving
      setEditingId((prev) => {
        const next = { ...prev };
        for (const r of rows) next[r.supplierId] = false;
        return next;
      });

      setMessage("success", "Saved.");
    } catch (e: any) {
      setMessage("error", String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!locationId) return;
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
      `}</style>

      <main style={{ maxWidth: 1100, width: "100%", padding: 24 }}>
        {/* HEADER (matches Inventory) */}
        <header
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto 1fr",
            alignItems: "center",
            marginBottom: 24,
          }}
        >
          {/* LEFT: Dashboard */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link href={`/locations/${locationId}`} style={btnSoft(false)}>
              Dashboard
            </Link>
          </div>

          {/* CENTER: Title */}
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 30, fontWeight: 950, letterSpacing: -0.4 }}>
              Suppliers
            </div>
          </div>

          {/* RIGHT: Inventory */}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Link
              href={`/locations/${locationId}/inventory`}
              style={btnSoft(false)}
            >
              Inventory
            </Link>
          </div>
        </header>

        {msg ? (
          <section style={{ ...cardStyle, ...msgStyle() }}>{msg}</section>
        ) : null}

        {/* SUPPLIERS SECTION (matches Inventory SKUs section layout) */}
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
            <div style={{ fontWeight: 950 }}>Suppliers</div>

            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                onClick={() => setShowAdd((v) => !v)}
                style={btnSoft(false)}
              >
                + Add Supplier
              </button>

              <button
                onClick={saveAll}
                disabled={loading || rows.length === 0}
                style={btnPrimary(loading || rows.length === 0)}
              >
                Save
              </button>
            </div>
          </div>

          {showAdd && (
            <div
              style={{
                border: `1px solid ${COLORS.border}`,
                borderRadius: 12,
                padding: 12,
                background: "rgba(255,255,255,0.75)",
                display: "flex",
                flexWrap: "wrap",
                gap: 12,
                alignItems: "flex-end",
              }}
            >
              {/* Supplier Name */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 950,
                    color: COLORS.subtext,
                  }}
                >
                  Supplier Name
                </div>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g., MeatCo"
                  style={{ ...inputStyle, width: 220 }}
                />
              </div>

              {/* Wallet Address */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 950,
                    color: COLORS.subtext,
                  }}
                >
                  Wallet Address
                </div>
                <input
                  value={newWallet}
                  onChange={(e) => setNewWallet(e.target.value)}
                  placeholder="0x..."
                  style={{
                    ...inputStyle,
                    width: 360,
                    fontFamily: "ui-monospace, Menlo, monospace",
                  }}
                />
              </div>

              {/* Delivery Time */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 950,
                    color: COLORS.subtext,
                  }}
                >
                  Delivery Time (days)
                </div>
                <input
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={newLeadDraft}
                  onChange={(e) =>
                    setNewLeadDraft(sanitizeUnitsDraft(e.target.value))
                  }
                  onBlur={() =>
                    setNewLeadDraft(String(draftToNonNegInt(newLeadDraft)))
                  }
                  placeholder="0"
                  style={{ ...inputStyle, width: 160, textAlign: "right" }}
                />
              </div>

              {/* Buttons */}
              <button
                type="button"
                onClick={addLocalSupplier}
                style={btnPrimary(false)}
              >
                Add
              </button>

              <button
                type="button"
                onClick={() => setShowAdd(false)}
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
                  <th
                    style={{ textAlign: "left", padding: 10, fontWeight: 950 }}
                  >
                    Supplier
                  </th>
                  <th
                    style={{ textAlign: "left", padding: 10, fontWeight: 950 }}
                  >
                    Wallet address
                  </th>
                  <th
                    style={{ textAlign: "right", padding: 10, fontWeight: 950 }}
                  >
                    Delivery time (days)
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
                  const isEditing = !!editingId[r.supplierId];

                  const nameVal = draftName[r.supplierId] ?? r.name;
                  const addressVal =
                    draftAddress[r.supplierId] ?? r.payoutAddress;
                  const leadVal =
                    draftLead[r.supplierId] ?? String(r.leadTimeDays ?? 0);

                  return (
                    <tr key={r.supplierId}>
                      {/* Supplier */}
                      <td
                        style={{ padding: 10, borderTop: "1px solid #eef2f7" }}
                      >
                        {isEditing ? (
                          <input
                            value={nameVal}
                            onChange={(e) =>
                              setDraftName((p) => ({
                                ...p,
                                [r.supplierId]: e.target.value,
                              }))
                            }
                            style={{ ...inputStyle, width: 220 }}
                          />
                        ) : (
                          <div style={{ fontWeight: 900 }}>
                            {nameVal || "—"}
                          </div>
                        )}
                      </td>

                      {/* Wallet */}
                      <td
                        style={{ padding: 10, borderTop: "1px solid #eef2f7" }}
                      >
                        {isEditing ? (
                          <input
                            value={addressVal}
                            onChange={(e) =>
                              setDraftAddress((p) => ({
                                ...p,
                                [r.supplierId]: e.target.value,
                              }))
                            }
                            placeholder="0x..."
                            style={{
                              ...inputStyle,
                              width: 360,
                              fontFamily: "ui-monospace, Menlo, monospace",
                            }}
                          />
                        ) : (
                          <div
                            style={{
                              fontWeight: 850,
                              fontFamily: "ui-monospace, Menlo, monospace",
                            }}
                          >
                            {addressVal || "—"}
                          </div>
                        )}
                      </td>

                      {/* Lead time */}
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
                            value={leadVal}
                            onChange={(e) =>
                              setDraftLead((p) => ({
                                ...p,
                                [r.supplierId]: sanitizeUnitsDraft(
                                  e.target.value
                                ),
                              }))
                            }
                            onBlur={() => {
                              const n = draftToNonNegInt(
                                draftLead[r.supplierId] ?? ""
                              );
                              setDraftLead((p) => ({
                                ...p,
                                [r.supplierId]: String(n),
                              }));
                            }}
                            style={{
                              ...inputStyle,
                              width: 160,
                              textAlign: "right",
                            }}
                          />
                        ) : (
                          <div style={{ fontWeight: 850 }}>
                            {draftToNonNegInt(leadVal)}
                          </div>
                        )}
                      </td>

                      {/* Actions */}
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
                            setEditingId((p) => ({
                              ...p,
                              [r.supplierId]: !p[r.supplierId],
                            }))
                          }
                          style={btnGraySoft(false)}
                        >
                          {isEditing ? "Done" : "Edit"}
                        </button>

                        <span style={{ display: "inline-block", width: 8 }} />

                        <button
                          type="button"
                          onClick={() => {
                            if (confirm(`Delete "${r.supplierId}"?`)) {
                              deleteLocalSupplier(r.supplierId);
                            }
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
                      colSpan={4}
                      style={{
                        padding: 14,
                        color: COLORS.subtext,
                        fontWeight: 900,
                        borderTop: "1px solid #eef2f7",
                      }}
                    >
                      No suppliers yet.
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
