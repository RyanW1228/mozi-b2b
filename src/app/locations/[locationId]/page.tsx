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

function toISODate(d: any): string {
  const s = String(d ?? "");
  // expecting "YYYY-MM-DD" from your plan; keep it simple
  return s;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJsonWithTimeout(
  url: string,
  opts: RequestInit,
  timeoutMs: number
) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    const json = await res.json().catch(() => null);
    return { res, json };
  } finally {
    clearTimeout(id);
  }
}

function sanitizeIntDraft(input: string) {
  // digits only; allow empty while typing
  return input.replace(/[^\d]/g, "");
}

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function draftToClampedInt(draft: string, min: number, max: number) {
  if (!draft) return min; // if user leaves blank, snap to min
  const n = parseInt(draft, 10);
  if (!Number.isFinite(n) || Number.isNaN(n)) return min;
  return clampInt(Math.floor(n), min, max);
}

function safeNum(x: any): number | null {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function pillStyle(colors: {
  bg: string;
  border: string;
  text: string;
}): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "6px 10px",
    borderRadius: 999,
    border: `1px solid ${colors.border}`,
    background: colors.bg,
    color: colors.text,
    fontWeight: 900,
    fontSize: 12,
    lineHeight: 1,
    whiteSpace: "nowrap",
  };
}

function strategyLabel(
  s: PlanInput["ownerPrefs"]["strategy"] | string | null | undefined
) {
  switch (s) {
    case "min_waste":
      return "Minimize Waste";
    case "balanced":
      return "Balanced";
    case "min_stockouts":
      return "Minimize Stockouts";
    default:
      return String(s ?? "—");
  }
}

function HelpDot({
  title = "What do these mean?",
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        aria-label={title}
        title={title}
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setOpen(false)}
        style={{
          width: 22,
          height: 22,
          borderRadius: "50%",
          border: `1px solid ${COLORS.border}`,
          background: "rgba(255,255,255,0.85)",
          color: COLORS.subtext,
          fontWeight: 950,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          lineHeight: 1,
          padding: 0,
          userSelect: "none",
        }}
      >
        ?
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Purchase plan help"
          style={{
            position: "absolute",
            top: 28,
            right: 0,
            width: 360,
            maxWidth: "80vw",
            padding: 12,
            borderRadius: 12,
            border: `1px solid ${COLORS.border}`,
            background: "rgba(255,255,255,0.98)",
            boxShadow: "0 12px 28px rgba(0,0,0,0.12)",
            color: COLORS.text,
            fontWeight: 750,
            zIndex: 50,
          }}
        >
          {children}
        </div>
      ) : null}
    </span>
  );
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
  // Draft text value so typing is smooth (like inventory inputs)
  const [horizonDaysDraft, setHorizonDaysDraft] = useState<string>("7");
  const [notes, setNotes] = useState<string>("Normal week");

  const [paymentIntent, setPaymentIntent] = useState<any>(null);
  const [executeResp, setExecuteResp] = useState<any>(null);

  type PlanSnapshot = {
    id: string; // unique key for dropdown
    createdAtMs: number;
    input: PlanInput;
    plan: PlanOutput;
    paymentIntent: any;
    executeResp: any;
  };

  const [planHistory, setPlanHistory] = useState<PlanSnapshot[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string>("");

  const selectedSnapshot = useMemo(() => {
    if (!planHistory.length) return null;
    if (!selectedPlanId) return planHistory[0]; // default: newest
    return planHistory.find((p) => p.id === selectedPlanId) ?? planHistory[0];
  }, [planHistory, selectedPlanId]);

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

  const [refreshCooldownUntilMs, setRefreshCooldownUntilMs] = useState(0);
  const refreshCooldownMs = 5000; // 3 seconds

  const [cooldownTick, setCooldownTick] = useState(0);

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
  const refreshOrdersInFlight = useRef(false);

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
    // Prevent overlapping refreshes (manual + auto + propose)
    if (refreshOrdersInFlight.current) return;
    refreshOrdersInFlight.current = true;

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

      const TIMEOUT_MS = 12_000; // 12s
      const RETRY_DELAY_MS = 800; // 0.8s

      let res: Response | null = null;
      let json: any = null;

      // 1st attempt
      ({ res, json } = await fetchJsonWithTimeout(
        url,
        { method: "GET" },
        TIMEOUT_MS
      ));

      // If it fails with the specific flaky error, retry once.
      const missingResponse =
        (json &&
          typeof json?.error === "string" &&
          json.error.includes("missing response")) ||
        (json &&
          typeof json?.message === "string" &&
          json.message.includes("missing response"));

      if ((!res.ok || !json?.ok) && missingResponse) {
        await sleep(RETRY_DELAY_MS);

        ({ res, json } = await fetchJsonWithTimeout(
          url,
          { method: "GET" },
          TIMEOUT_MS
        ));
      }

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
      refreshOrdersInFlight.current = false;
    }
  }

  async function refreshOrdersWithCooldown() {
    const now = Date.now();

    // If still cooling down or already loading, do nothing.
    if (ordersLoading) return;
    if (now < refreshCooldownUntilMs) return;

    // Start cooldown immediately (prevents spam-click double fires)
    setRefreshCooldownUntilMs(now + refreshCooldownMs);

    await refreshOrders();
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
    if (typeof window === "undefined") return;

    const s = window.localStorage.getItem("mozi_plan_strategy");
    const h = window.localStorage.getItem("mozi_plan_horizon_days");
    const n = window.localStorage.getItem("mozi_plan_notes");

    if (s === "min_waste" || s === "balanced" || s === "min_stockouts") {
      setStrategy(s);
    }

    if (h) {
      const parsed = parseInt(h, 10);
      if (Number.isFinite(parsed)) {
        setHorizonDays(Math.max(5, Math.min(30, parsed)));
      }
    }

    if (typeof n === "string") setNotes(n);
  }, []);

  useEffect(() => {
    setHorizonDaysDraft(String(horizonDays));
  }, [horizonDays]);

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

  useEffect(() => {
    if (Date.now() >= refreshCooldownUntilMs) return;

    const id = window.setInterval(() => {
      setCooldownTick((x) => x + 1);
    }, 250);

    return () => window.clearInterval(id);
  }, [refreshCooldownUntilMs]);

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

        {/* Generate Purchase Plan */}
        <section style={cardStyle}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              marginBottom: 8,
            }}
          >
            {/* Left: title + ? bubble right next to it */}
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ fontWeight: 950, fontSize: 16 }}>Purchase Plan</div>

              <HelpDot title="Explain plan settings">
                <div style={{ fontWeight: 950, marginBottom: 8 }}>
                  Plan settings
                </div>

                <div style={{ display: "grid", gap: 10, fontSize: 13 }}>
                  <div>
                    <div style={{ fontWeight: 950 }}>Strategy</div>
                    <div style={{ color: COLORS.subtext, fontWeight: 750 }}>
                      How Mozi trades off waste vs. stockouts when choosing
                      quantities.
                      <div style={{ marginTop: 6 }}>
                        <span style={{ fontWeight: 900 }}>
                          {strategyLabel("min_waste")}
                        </span>
                        : order less, accept higher stockout risk •{" "}
                        <span style={{ fontWeight: 900 }}>
                          {strategyLabel("balanced")}
                        </span>
                        : default tradeoff •{" "}
                        <span style={{ fontWeight: 900 }}>
                          {strategyLabel("min_stockouts")}
                        </span>
                        : order more, accept higher waste risk
                      </div>
                    </div>
                  </div>

                  <div>
                    <div style={{ fontWeight: 950 }}>Planning Horizon</div>
                    <div style={{ color: COLORS.subtext, fontWeight: 750 }}>
                      How far into the future Mozi looks when deciding what to
                      order today. A longer horizon means Mozi considers
                      upcoming demand and deliveries further out; a shorter
                      horizon makes it focus more on the near term.
                    </div>
                  </div>

                  <div>
                    <div style={{ fontWeight: 950 }}>Additional Context</div>
                    <div style={{ color: COLORS.subtext, fontWeight: 750 }}>
                      Short notes that adjust assumptions (events, seasonality,
                      promos, unusual weeks). Example: “Football weekend” can
                      bias expected demand.
                    </div>
                  </div>
                </div>
              </HelpDot>
            </div>

            {/* Right: Save button */}
            <button
              type="button"
              onClick={() => {
                if (typeof window === "undefined") return;

                window.localStorage.setItem("mozi_plan_strategy", strategy);
                window.localStorage.setItem(
                  "mozi_plan_horizon_days",
                  String(horizonDays)
                );
                window.localStorage.setItem("mozi_plan_notes", notes);

                // optional: quick feedback without adding new UI state
                // (if you want a real status message, tell me and I'll wire it)
              }}
              style={btnSoft(false)}
              title="Save plan settings"
            >
              Save
            </button>
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
                <option value="min_waste">{strategyLabel("min_waste")}</option>
                <option value="balanced">{strategyLabel("balanced")}</option>
                <option value="min_stockouts">
                  {strategyLabel("min_stockouts")}
                </option>
              </select>
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label style={{ fontWeight: 900, color: COLORS.subtext }}>
                Planning Horizon
              </label>
              <input
                inputMode="numeric"
                pattern="[0-9]*"
                value={horizonDaysDraft}
                onChange={(e) => {
                  setHorizonDaysDraft(sanitizeIntDraft(e.target.value));
                }}
                onBlur={() => {
                  const normalized = draftToClampedInt(horizonDaysDraft, 5, 30);
                  setHorizonDays(normalized);
                  setHorizonDaysDraft(String(normalized));
                }}
                onFocus={(e) => e.currentTarget.select()}
                style={{
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: `1px solid ${COLORS.border}`,
                  background: "rgba(255,255,255,0.85)",
                  color: COLORS.text,
                  fontWeight: 800,
                  outline: "none",
                  fontSize: 16, // nicer to type (matches inventory idea)
                }}
              />
            </div>

            <div style={{ display: "grid", gap: 6, gridColumn: "1 / -1" }}>
              <label style={{ fontWeight: 900, color: COLORS.subtext }}>
                Additional Context
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
              justifyContent: "flex-end",
              marginTop: 8, // 🔧 tighter vertical spacing
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

          {/* Generated Plan (shows here) */}
          {error ? (
            <div
              style={{
                marginTop: 12,
                border: `1px solid ${COLORS.dangerBorder}`,
                background: COLORS.dangerBg,
                color: COLORS.dangerText,
                borderRadius: 12,
                padding: 12,
                fontWeight: 800,
                whiteSpace: "pre-wrap",
              }}
            >
              {error}
            </div>
          ) : null}

          {plan ? (
            <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
              <div style={{ fontWeight: 950, fontSize: 16 }}>
                Generated Plan
              </div>
              <div style={{ color: COLORS.subtext, fontWeight: 800 }}>
                Generated: {plan.generatedAt} • Horizon: {plan.horizonDays} days
              </div>

              {/* Orders */}
              <div style={{ display: "grid", gap: 10 }}>
                {plan.orders.map((order, idx) => (
                  <details
                    key={idx}
                    open={idx === 0}
                    style={{
                      border: `1px solid ${COLORS.border}`,
                      borderRadius: 12,
                      background: "rgba(255,255,255,0.75)",
                      padding: 12,
                    }}
                  >
                    <summary style={{ cursor: "pointer", fontWeight: 950 }}>
                      Supplier:{" "}
                      <span
                        style={{ fontFamily: "ui-monospace, Menlo, monospace" }}
                      >
                        {order.supplierId}
                      </span>{" "}
                      • {order.orderDate} • {order.items.length} items
                    </summary>

                    <div
                      style={{
                        marginTop: 10,
                        overflowX: "auto",
                        border: `1px solid ${COLORS.border}`,
                        borderRadius: 12,
                        background: "rgba(255,255,255,0.75)",
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
                  </details>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        {/* On-chain Orders (read-only) */}
        <section style={cardStyle}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
            }}
          >
            {/* Left: title + pill */}
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ fontWeight: 950, fontSize: 16 }}>Orders</div>

              {requireApproval === null ? null : requireApproval ? (
                <span
                  style={pillStyle({
                    bg: COLORS.warnBg,
                    border: COLORS.warnBorder,
                    text: COLORS.warnText,
                  })}
                >
                  Manual
                </span>
              ) : (
                <span
                  style={pillStyle({
                    bg: COLORS.greenBg,
                    border: COLORS.greenBorder,
                    text: COLORS.greenText,
                  })}
                >
                  Autonomous
                </span>
              )}
            </div>

            {/* Right: Refresh button */}
            {(() => {
              const cooldownRemainingMs = Math.max(
                0,
                refreshCooldownUntilMs - Date.now()
              );
              const refreshDisabled = ordersLoading || cooldownRemainingMs > 0;

              const tooltip = ordersLoading
                ? "Refreshing orders…"
                : cooldownRemainingMs > 0
                ? `Please wait ${Math.ceil(
                    cooldownRemainingMs / 1000
                  )}s before refreshing again (prevents server errors).`
                : "Refresh orders";

              return (
                <button
                  type="button"
                  onClick={refreshOrdersWithCooldown}
                  disabled={refreshDisabled}
                  title={tooltip}
                  style={btnSoft(refreshDisabled)}
                >
                  Refresh
                </button>
              );
            })()}
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

                const showApprove = requireApproval === true;
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
                    {/* ... keep your existing intent UI exactly as-is ... */}
                    {/* (I’m not repeating it here; paste your existing intent rendering block unchanged) */}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
