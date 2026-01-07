// src/app/locations/[locationId]/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PlanInput, PlanOutput } from "@/lib/types";
import Link from "next/link";
import { useParams } from "next/navigation";
import { buildPaymentIntentFromPlan } from "@/lib/pricing";
import {
  BrowserProvider,
  Contract,
  isAddress,
  keccak256,
  toUtf8Bytes,
} from "ethers";
import { MOZI_TREASURY_HUB_ABI } from "@/lib/abis/moziTreasuryHub";

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

const TREASURY_HUB_ADDRESS =
  process.env.NEXT_PUBLIC_MOZI_TREASURY_HUB_ADDRESS ?? "";

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

  // bytes32 restaurantId used on-chain (matches your execute route)
  const locationRestaurantId = useMemo(() => {
    if (!locationId) return "";
    return keccak256(toUtf8Bytes(locationId));
  }, [locationId]);

  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState<PlanOutput | null>(null);
  const [error, setError] = useState<string>("");

  const [strategy, setStrategy] =
    useState<PlanInput["ownerPrefs"]["strategy"]>("balanced");
  const [horizonDays, setHorizonDays] = useState<number>(7);
  const [notes, setNotes] = useState<string>("Normal week");

  const [paymentIntent, setPaymentIntent] = useState<any>(null);
  const [executeResp, setExecuteResp] = useState<any>(null);

  // -------------------------
  // On-chain orders (grouped by intent ref)
  // -------------------------
  type IntentRow = {
    ref: string;
    owner: string;
    restaurantId: string;
    executeAfter: number;
    canceled: boolean;
    executed: boolean;
    approved: boolean;
    items: Array<{
      orderId: string;
      supplier: string;
      amount: string; // raw uint256 string
      executeAfter: number;
      canceled: boolean;
      executed: boolean;
    }>;
  };

  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState<string>("");
  const [intents, setIntents] = useState<IntentRow[]>([]);

  // Manual vs Autonomous (from chain)
  const [requireApproval, setRequireApproval] = useState<boolean | null>(null);

  // UI state for approve button
  const [approvingRef, setApprovingRef] = useState<string | null>(null);

  // -------------------------
  // Auto-propose (periodic)
  // -------------------------
  const [autoProposeEnabled, setAutoProposeEnabled] = useState(true);
  const [autoProposeMsg, setAutoProposeMsg] = useState<string>("");
  const autoProposeInFlight = useRef(false);

  function getSavedEnv(): "testing" | "production" {
    if (typeof window === "undefined") return "testing";
    const v = window.localStorage.getItem("mozi_env");
    return v === "production" ? "production" : "testing";
  }

  function getSavedOwnerAddress(): string | null {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem("mozi_wallet_address");
  }

  function fmtWhen(ts: number) {
    if (!ts) return "—";
    try {
      return new Date(ts * 1000).toLocaleString();
    } catch {
      return String(ts);
    }
  }

  function intentStatus(i: IntentRow) {
    if (i.canceled) return "Canceled";
    if (i.executed) return "Executed";
    if (i.approved) return "Approved";
    return "Pending";
  }

  async function autoProposeNow() {
    const owner = getSavedOwnerAddress();
    const env = getSavedEnv();

    if (!locationId) return;

    if (!owner || !isAddress(owner)) {
      setAutoProposeMsg("Connect wallet on homepage first.");
      return;
    }

    if (autoProposeInFlight.current) return;
    autoProposeInFlight.current = true;

    try {
      setAutoProposeMsg("Auto-propose: proposing…");

      const res = await fetch(
        `/api/orders/propose?locationId=${encodeURIComponent(locationId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            env,
            ownerAddress: owner,
            pendingWindowHours: 24,

            // keep proposer aligned with the UI controls
            strategy,
            horizonDays,
            notes,
          }),
        }
      );

      const json = await res.json();

      if (!res.ok || !json?.ok) {
        setAutoProposeMsg(
          `Auto-propose failed (HTTP ${res.status}): ${JSON.stringify(json)}`
        );
        return;
      }

      setAutoProposeMsg("Auto-propose: proposed ✔");
      await refreshOrders();
    } catch (e: any) {
      setAutoProposeMsg(`Auto-propose error: ${String(e?.message ?? e)}`);
    } finally {
      autoProposeInFlight.current = false;
    }
  }

  async function refreshOrders() {
    const owner = getSavedOwnerAddress();
    const env = getSavedEnv();

    if (!owner || !isAddress(owner)) {
      setIntents([]);
      setRequireApproval(null);
      setOrdersError(
        "No valid wallet found. Go to the homepage, connect wallet, then come back."
      );
      return;
    }

    if (!locationId) {
      setIntents([]);
      setRequireApproval(null);
      setOrdersError("Missing locationId.");
      return;
    }

    setOrdersLoading(true);
    setOrdersError("");

    try {
      // 1) read intent groups from your API
      const url =
        `/api/orders/list?env=${encodeURIComponent(env)}` +
        `&owner=${encodeURIComponent(owner)}` +
        `&locationId=${encodeURIComponent(locationId)}`;

      const res = await fetch(url);
      const json = await res.json();

      if (!res.ok || !json?.ok) {
        setIntents([]);
        setOrdersError(
          `ORDERS HTTP ${res.status}\n` + JSON.stringify(json, null, 2)
        );
        return;
      }

      const raw = (json.intents ?? []) as IntentRow[];

      // Hard guard: keep ONLY intents for this location (restaurantId)
      const scoped = raw.filter(
        (i) =>
          String(i.restaurantId || "").toLowerCase() ===
          String(locationRestaurantId || "").toLowerCase()
      );

      setIntents(scoped);

      // 2) read manual/autonomous mode from chain
      if (
        !TREASURY_HUB_ADDRESS ||
        !isAddress(TREASURY_HUB_ADDRESS) ||
        typeof window === "undefined" ||
        !(window as any).ethereum
      ) {
        setRequireApproval(null);
        return;
      }

      const provider = new BrowserProvider((window as any).ethereum);
      const hub = new Contract(
        TREASURY_HUB_ADDRESS,
        MOZI_TREASURY_HUB_ABI,
        provider
      );

      const req = (await (hub as any).requireApprovalForExecution(
        owner
      )) as boolean;

      setRequireApproval(Boolean(req));
    } catch (e: any) {
      setIntents([]);
      setRequireApproval(null);
      setOrdersError(String(e));
    } finally {
      setOrdersLoading(false);
    }
  }

  async function approveIntent(ref: string) {
    const owner = getSavedOwnerAddress();
    if (!owner || !isAddress(owner)) {
      setOrdersError(
        "No valid wallet found. Connect wallet on homepage first."
      );
      return;
    }
    if (!TREASURY_HUB_ADDRESS || !isAddress(TREASURY_HUB_ADDRESS)) {
      setOrdersError("Missing/invalid NEXT_PUBLIC_MOZI_TREASURY_HUB_ADDRESS.");
      return;
    }
    if (typeof window === "undefined" || !(window as any).ethereum) {
      setOrdersError("No injected wallet found (window.ethereum missing).");
      return;
    }

    try {
      setOrdersError("");
      setApprovingRef(ref);

      const provider = new BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner();

      // optional: sanity check signer matches saved owner
      const signerAddr = await signer.getAddress();
      if (signerAddr.toLowerCase() !== owner.toLowerCase()) {
        setOrdersError("Connected wallet does not match saved owner address.");
        return;
      }

      const hub = new Contract(
        TREASURY_HUB_ADDRESS,
        MOZI_TREASURY_HUB_ABI,
        signer
      );

      // Approve this intent ref
      const tx = await (hub as any).setIntentApproval(ref, true);
      await tx.wait();

      await refreshOrders();
    } catch (e: any) {
      setOrdersError(String(e?.shortMessage || e?.reason || e?.message || e));
    } finally {
      setApprovingRef(null);
    }
  }

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
      const owner = getSavedOwnerAddress();
      const env = getSavedEnv();

      if (!owner || !isAddress(owner)) {
        setError(
          "No valid wallet found. Go to the homepage, connect wallet, then come back here."
        );
        return;
      }

      const stateRes = await fetch(
        `/api/state?locationId=${encodeURIComponent(locationId)}` +
          `&owner=${encodeURIComponent(owner)}` +
          `&env=${encodeURIComponent(env)}`
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
              ownerAddress: owner,
              input,
              plan: data,
              paymentIntent: pi,
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

  useEffect(() => {
    // On first load, bind this location to the connected owner wallet (if available)
    const owner = getSavedOwnerAddress();
    if (!locationId || !owner || !isAddress(owner)) return;

    fetch(`/api/state/owner?locationId=${encodeURIComponent(locationId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerAddress: owner }),
    }).catch(() => {
      // silent (MVP)
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId]);

  useEffect(() => {
    // Read-only load on first render for this location page
    refreshOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId]);

  useEffect(() => {
    if (!locationId) return;
    if (!autoProposeEnabled) return;

    // run once immediately, then every 60s while page is open
    autoProposeNow();

    const id = window.setInterval(() => {
      autoProposeNow();
    }, 60_000);

    return () => window.clearInterval(id);

    // IMPORTANT: include controls so the proposer uses the latest settings
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId, autoProposeEnabled, strategy, horizonDays, notes]);

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

        {/* On-chain Orders (read-only) */}
        <section style={cardStyle}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <div
              style={{
                marginTop: 8,
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <button
                onClick={() => setAutoProposeEnabled((v) => !v)}
                style={btnSoft(false)}
              >
                Auto-propose: {autoProposeEnabled ? "ON" : "OFF"}
              </button>

              <div style={{ color: COLORS.subtext, fontWeight: 800 }}>
                {autoProposeMsg ||
                  (autoProposeEnabled ? "Running every 60s" : "Paused")}
              </div>
            </div>

            <button
              onClick={refreshOrders}
              disabled={ordersLoading}
              style={btnSoft(ordersLoading)}
            >
              {ordersLoading ? "Refreshing…" : "Refresh Orders"}
            </button>
          </div>

          {ordersError ? (
            <div
              style={{
                border: `1px solid ${COLORS.warnBorder}`,
                background: COLORS.warnBg,
                color: COLORS.warnText,
                borderRadius: 12,
                padding: 12,
                fontWeight: 800,
                whiteSpace: "pre-wrap",
              }}
            >
              {ordersError}
            </div>
          ) : intents.length === 0 ? (
            <div style={{ color: COLORS.subtext, fontWeight: 800 }}>
              No orders found.
            </div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {intents.map((i) => {
                const now = Math.floor(Date.now() / 1000);
                const pending =
                  !i.canceled && !i.executed && now < Number(i.executeAfter);

                // Only show Approve in Manual mode
                const showApprove = requireApproval === true;

                // Can approve only if pending, not already approved/canceled/executed
                const canApprove =
                  showApprove &&
                  pending &&
                  !i.approved &&
                  approvingRef !== i.ref;

                return (
                  <div
                    key={i.ref}
                    style={{
                      border: `1px solid ${COLORS.border}`,
                      borderRadius: 12,
                      padding: 12,
                      background: "rgba(255,255,255,0.75)",
                      display: "grid",
                      gap: 10,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                        alignItems: "center",
                        flexWrap: "wrap",
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 950 }}>
                          Intent:{" "}
                          <span
                            style={{
                              fontFamily: "ui-monospace, Menlo, monospace",
                            }}
                          >
                            {shortenId(i.ref)}
                          </span>
                        </div>
                        <div
                          style={{
                            marginTop: 4,
                            color: COLORS.subtext,
                            fontWeight: 800,
                          }}
                        >
                          Execute after: {fmtWhen(i.executeAfter)} • Status:{" "}
                          {intentStatus(i)}
                        </div>
                      </div>

                      {showApprove ? (
                        <button
                          onClick={() => approveIntent(i.ref)}
                          disabled={!canApprove}
                          style={btnPrimary(!canApprove)}
                        >
                          {approvingRef === i.ref
                            ? "Approving…"
                            : "Approve Intent"}
                        </button>
                      ) : (
                        <div style={{ color: COLORS.subtext, fontWeight: 800 }}>
                          Autonomous (no approval needed)
                        </div>
                      )}
                    </div>

                    <div
                      style={{
                        overflowX: "auto",
                        border: `1px solid ${COLORS.border}`,
                        borderRadius: 12,
                        background: "rgba(255,255,255,0.85)",
                      }}
                    >
                      <table
                        style={{ width: "100%", borderCollapse: "collapse" }}
                      >
                        <thead>
                          <tr>
                            <th
                              style={{
                                textAlign: "left",
                                padding: 12,
                                fontWeight: 950,
                              }}
                            >
                              Order
                            </th>
                            <th
                              style={{
                                textAlign: "left",
                                padding: 12,
                                fontWeight: 950,
                              }}
                            >
                              Supplier
                            </th>
                            <th
                              style={{
                                textAlign: "left",
                                padding: 12,
                                fontWeight: 950,
                              }}
                            >
                              Execute After
                            </th>
                            <th
                              style={{
                                textAlign: "left",
                                padding: 12,
                                fontWeight: 950,
                              }}
                            >
                              Status
                            </th>
                            <th
                              style={{
                                textAlign: "right",
                                padding: 12,
                                fontWeight: 950,
                              }}
                            >
                              Amount (raw)
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {i.items.map((o) => (
                            <tr key={o.orderId}>
                              <td
                                style={{
                                  padding: 12,
                                  borderTop: "1px solid #eef2f7",
                                }}
                              >
                                #{o.orderId}
                              </td>
                              <td
                                style={{
                                  padding: 12,
                                  borderTop: "1px solid #eef2f7",
                                  fontFamily: "ui-monospace, Menlo, monospace",
                                  fontWeight: 800,
                                }}
                              >
                                {o.supplier}
                              </td>
                              <td
                                style={{
                                  padding: 12,
                                  borderTop: "1px solid #eef2f7",
                                }}
                              >
                                {fmtWhen(o.executeAfter)}
                              </td>
                              <td
                                style={{
                                  padding: 12,
                                  borderTop: "1px solid #eef2f7",
                                  fontWeight: 900,
                                }}
                              >
                                {o.canceled
                                  ? "Canceled"
                                  : o.executed
                                  ? "Executed"
                                  : "Pending"}
                              </td>
                              <td
                                style={{
                                  padding: 12,
                                  borderTop: "1px solid #eef2f7",
                                  textAlign: "right",
                                  fontFamily: "ui-monospace, Menlo, monospace",
                                  fontWeight: 800,
                                }}
                              >
                                {o.amount}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

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
