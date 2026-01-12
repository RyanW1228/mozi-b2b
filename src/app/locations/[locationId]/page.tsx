// src/app/locations/[locationId]/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PlanInput, PlanOutput } from "@/lib/types";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  BrowserProvider,
  Contract,
  formatUnits,
  isAddress,
  keccak256,
  toUtf8Bytes,
  verifyMessage,
} from "ethers";

import { MOZI_TREASURY_HUB_ABI } from "@/lib/abis/moziTreasuryHub";
import { COLORS } from "@/lib/constants";
import {
  shortenId,
  sleep,
  fetchJsonWithTimeout,
  sanitizeIntDraft,
  draftToClampedInt,
  pillStyle,
  strategyLabel,
} from "@/lib/utils";

const TREASURY_HUB_ADDRESS =
  process.env.NEXT_PUBLIC_MOZI_TREASURY_HUB_ADDRESS ?? "";

function demoTimeKey(locationId: string) {
  // store the absolute simulated "now" (ms since epoch), not an offset
  return `mozi_demo_time_now_ms:${locationId}`;
}

function demoConsumedKey(locationId: string) {
  return `mozi_demo_consumed_units:${locationId}`;
}

function demoConsumeStatsKey(locationId: string) {
  return `mozi_demo_consume_stats:${locationId}`;
}

function chatMemoryKey(env: string, owner: string, locationId: string) {
  return `mozi_chat_memory:${env}:${owner.toLowerCase()}:${locationId}`;
}

function loadChatMemory(env: string, owner: string, locationId: string) {
  if (typeof window === "undefined") return "";
  return (
    window.localStorage.getItem(chatMemoryKey(env, owner, locationId)) ?? ""
  );
}

function saveChatMemory(
  env: string,
  owner: string,
  locationId: string,
  value: string
) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(chatMemoryKey(env, owner, locationId), value);
}

function HelpDot({
  title = "What do these mean?",
  align = "auto",
  children,
}: {
  title?: string;
  align?: "left" | "right" | "auto";
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  // computed alignment when open
  const [computedAlign, setComputedAlign] = useState<"left" | "right">("left");

  useEffect(() => {
    if (!open) return;

    const POP_W = 360; // your popover width
    const MARGIN = 16;

    const compute = () => {
      const rect = btnRef.current?.getBoundingClientRect();
      if (!rect) return;

      const vw = window.innerWidth;

      // If we anchor popover with left:0 (expands right), will it overflow viewport?
      const wouldOverflowRight = rect.left + POP_W + MARGIN > vw;

      // If it would overflow right, expand left instead (right:0).
      setComputedAlign(wouldOverflowRight ? "right" : "left");
    };

    compute();
    window.addEventListener("resize", compute);
    window.addEventListener("scroll", compute, true);

    return () => {
      window.removeEventListener("resize", compute);
      window.removeEventListener("scroll", compute, true);
    };
  }, [open]);

  const finalAlign: "left" | "right" = align === "auto" ? computedAlign : align;

  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <button
        ref={btnRef}
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
          aria-label="Help"
          style={{
            position: "absolute",
            top: 28,
            ...(finalAlign === "left" ? { left: 0 } : { right: 0 }),
            width: 360,
            maxWidth: "min(360px, calc(100vw - 32px))",
            padding: 12,
            borderRadius: 12,
            border: `1px solid ${COLORS.border}`,
            background: "rgba(255,255,255,0.98)",
            boxShadow: "0 12px 28px rgba(0,0,0,0.12)",
            color: COLORS.text,
            fontWeight: 750,
            zIndex: 5000, // higher than the chat drawer
            overflowWrap: "anywhere",
          }}
        >
          {children}
        </div>
      ) : null}
    </span>
  );
}

function ChevronDown({ open }: { open: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        transform: open ? "rotate(180deg)" : "rotate(0deg)",
        transition: "transform 120ms ease",
        fontSize: 16,
        lineHeight: 1,
      }}
    >
      ▾
    </span>
  );
}

export default function LocationPage() {
  const params = useParams<{ locationId: string }>();

  // --- Chat UI styles ---
  const chatPanelBg = [
    "radial-gradient(900px 500px at 20% 10%, rgba(37,99,235,0.12) 0%, rgba(37,99,235,0) 60%)",
    "radial-gradient(800px 500px at 80% 30%, rgba(99,102,241,0.10) 0%, rgba(99,102,241,0) 55%)",
    "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(248,250,252,0.98) 55%, rgba(255,255,255,0.98) 100%)",
  ].join(",");

  const chatCloseBtn: React.CSSProperties = {
    width: 36,
    height: 36,
    borderRadius: 12,
    border: `1px solid ${COLORS.dangerBorder}`,
    background: COLORS.dangerBg,
    color: COLORS.dangerText,
    fontWeight: 1000,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 8px 18px rgba(153,27,27,0.15)",
  };

  function bubbleStyle(role: "user" | "assistant"): React.CSSProperties {
    const isUser = role === "user";
    return {
      maxWidth: "85%",
      padding: "10px 12px",
      borderRadius: 16,
      border: `1px solid ${COLORS.border}`,
      background: isUser ? "rgba(37,99,235,0.10)" : "rgba(255,255,255,0.92)",
      color: COLORS.text,
      fontWeight: 800,
      lineHeight: 1.35,
      boxShadow: "0 10px 20px rgba(0,0,0,0.06)",
      whiteSpace: "pre-wrap",
    };
  }

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

  // --- Demo time travel (UI-only) ---
  // Store absolute simulated "now" (ms since epoch). Persist to localStorage.
  const [demoNowMsAbs, setDemoNowMsAbs] = useState<number | null>(null);

  const [demoConsumedUnits, setDemoConsumedUnits] = useState<number>(0);
  const [demoThrownOutUnits, setDemoThrownOutUnits] = useState<number>(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!locationId) return;

    try {
      const raw = window.localStorage.getItem(demoConsumedKey(locationId));
      const n = raw != null ? Number(raw) : NaN;
      setDemoConsumedUnits(Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0);
    } catch {
      setDemoConsumedUnits(0);
    }
  }, [locationId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!locationId) return;

    try {
      window.localStorage.setItem(
        demoConsumedKey(locationId),
        String(demoConsumedUnits)
      );
    } catch {
      // ignore
    }
  }, [demoConsumedUnits, locationId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!locationId) return;

    try {
      const raw = window.localStorage.getItem(demoTimeKey(locationId));
      const stored = raw != null ? Number(raw) : NaN;

      if (Number.isFinite(stored) && stored > 0) {
        setDemoNowMsAbs(stored);
      } else {
        setDemoNowMsAbs(Date.now());
      }
    } catch {
      setDemoNowMsAbs(Date.now());
    }
  }, [locationId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!locationId) return;
    if (demoNowMsAbs == null) return;

    try {
      window.localStorage.setItem(
        demoTimeKey(locationId),
        String(demoNowMsAbs)
      );
    } catch {
      // ignore
    }
  }, [demoNowMsAbs, locationId]);

  function demoNowMs() {
    // fallback so UI doesn't crash before hydration completes
    return demoNowMsAbs ?? Date.now();
  }

  function demoOffsetMs() {
    // how far the simulated clock is ahead/behind real wall clock
    return demoNowMs() - Date.now();
  }

  function fmtWhenDemo(tsUnix: number) {
    if (!tsUnix) return "—";
    try {
      return new Date(tsUnix * 1000 + demoOffsetMs()).toLocaleString();
    } catch {
      return String(tsUnix);
    }
  }

  function fmtWhenFixedUnix(tsUnix: number) {
    if (!tsUnix) return "—";
    try {
      // IMPORTANT: no demoOffset here; this is a stored timestamp
      return new Date(tsUnix * 1000).toLocaleString();
    } catch {
      return String(tsUnix);
    }
  }

  // --- Simulate inventory depletion (UI-only time travel drives server inventory) ---
  function makeSeededRng(seed: number) {
    // deterministic LCG (good enough for demo)
    let s = seed >>> 0;
    return () => {
      s = (1664525 * s + 1013904223) >>> 0;
      return s / 2 ** 32; // [0,1)
    };
  }

  function clampInt(n: number, lo: number, hi: number) {
    const x = Math.floor(n);
    return Math.max(lo, Math.min(hi, x));
  }

  async function consumeInventoryForSimulatedDays(
    daysAdvanced: number,
    baseNowMsOverride?: number
  ) {
    if (!locationId || daysAdvanced <= 0) return;

    // pull latest state snapshot so depletion uses current inventory + sales
    const owner = getSavedOwnerAddress();
    const env = getSavedEnv();

    const stateRes = await fetch(
      `/api/state?locationId=${encodeURIComponent(locationId)}` +
        (owner ? `&owner=${encodeURIComponent(owner)}` : "") +
        `&env=${encodeURIComponent(env)}`
    ).catch(() => null);

    if (!stateRes || !stateRes.ok) return;
    const state = await stateRes.json().catch(() => null);
    if (!state) return;

    const inventory = Array.isArray(state.inventory) ? state.inventory : [];
    const salesBySku = Array.isArray(state?.sales?.bySku)
      ? state.sales.bySku
      : [];
    const windowDays = Number(state?.sales?.windowDays ?? 7) || 7;

    const DAY_MS = 24 * 60 * 60 * 1000;

    // --- Build mean daily usage per SKU from your displayed "daily usage" basis ---
    // dailyMean = unitsSold / windowDays
    const dailyMeanBySku = new Map<string, number>();
    for (const row of salesBySku) {
      const sku = String(row?.sku ?? "");
      const unitsSold = Number(row?.unitsSold ?? 0);
      if (!sku) continue;
      const mean = Math.max(0, unitsSold / Math.max(1, windowDays));
      dailyMeanBySku.set(sku, mean);
    }

    // --- Helper: deterministic normal(0,1) from seeded rng (Box–Muller) ---
    function randNormal(rng: () => number) {
      // avoid log(0)
      const u1 = Math.max(1e-12, rng());
      const u2 = rng();
      return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    }

    // --- Helper: Poisson-ish sample around mean ---
    // - For very small means (<1): treat as Bernoulli-ish
    // - For larger means: normal approximation with variance ~ mean
    function sampleUnitsFromMean(mean: number, rng: () => number) {
      if (!Number.isFinite(mean) || mean <= 0) return 0;

      if (mean < 1) {
        // e.g., mean=0.3 -> 30% chance of 1 unit
        return rng() < mean ? 1 : 0;
      }

      // Poisson variance ≈ mean -> sd = sqrt(mean)
      const z = randNormal(rng);
      const raw = mean + z * Math.sqrt(mean);

      // clamp at 0, round to int
      return Math.max(0, Math.round(raw));
    }

    // Optional: upcoming event lift (same logic you already have, but per simulated day)
    const upcomingEvents = Array.isArray(state?.context?.upcomingEvents)
      ? state.context.upcomingEvents
      : [];

    // Collect consumption lines over N advanced days (usually N=1)
    // We generate per-day with a per-day seed so it’s stable for a given simulated day.
    const totalConsumeBySku = new Map<string, number>();

    for (let d = 0; d < daysAdvanced; d++) {
      const baseNowMs = baseNowMsOverride ?? demoNowMs();
      const simDayMs = baseNowMs + d * DAY_MS;

      const simDayIndex = Math.floor(simDayMs / DAY_MS);

      const rng = makeSeededRng(simDayIndex ^ 0x9e3779b9);

      const simIso = new Date(simDayMs).toISOString().slice(0, 10);
      const todaysEventLiftPct = upcomingEvents
        .filter((e: any) => String(e?.date ?? "") === simIso)
        .reduce(
          (acc: number, e: any) =>
            acc + Number(e?.expectedDemandLiftPercent ?? 0),
          0
        );

      const demandLift = 1 + Math.max(0, todaysEventLiftPct) / 100;

      for (const invRow of inventory) {
        const sku = String(invRow?.sku ?? "");
        const onHand = Number(invRow?.onHandUnits ?? 0);
        if (!sku || !Number.isFinite(onHand) || onHand <= 0) continue;

        // ✅ This is the key: consumption mean is your daily usage number
        const baseMean = dailyMeanBySku.get(sku) ?? 0;

        // If your “daily usage” is 0, consumption should usually be 0
        if (baseMean <= 0) continue;

        const meanToday = baseMean * demandLift;

        const units = sampleUnitsFromMean(meanToday, rng);
        if (units <= 0) continue;

        totalConsumeBySku.set(sku, (totalConsumeBySku.get(sku) ?? 0) + units);
      }
    }

    if (totalConsumeBySku.size === 0) return;

    // Build request lines; clamp to current onHand and cap payload size
    const MAX_LINES = 20; // keep your server call light

    const invOnHandBySku = new Map<string, number>();
    for (const invRow of inventory) {
      const sku = String(invRow?.sku ?? "");
      const onHand = Number(invRow?.onHandUnits ?? 0);
      if (!sku) continue;
      invOnHandBySku.set(
        sku,
        Number.isFinite(onHand) ? Math.max(0, Math.floor(onHand)) : 0
      );
    }

    let lines = Array.from(totalConsumeBySku.entries())
      .map(([sku, units]) => {
        const onHand = invOnHandBySku.get(sku) ?? 0;
        const clamped = clampInt(units, 0, onHand);
        return clamped > 0 ? { sku, units: clamped } : null;
      })
      .filter(Boolean) as { sku: string; units: number }[];

    if (lines.length === 0) return;

    // If too many SKUs consumed, keep the biggest drains (most realistic + smallest payload)
    if (lines.length > MAX_LINES) {
      lines = lines.sort((a, b) => b.units - a.units).slice(0, MAX_LINES);
    }

    await fetch(
      `/api/inventory/consume?locationId=${encodeURIComponent(locationId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines }),
      }
    ).catch(() => null);
  }

  function demoNowUnix() {
    return Math.floor(demoNowMs() / 1000);
  }

  // Treat simulated time as "real" time for UI state + stored timestamps
  function appNowMs() {
    return demoNowMs();
  }

  function appNowUnix() {
    return Math.floor(appNowMs() / 1000);
  }

  const [strategy, setStrategy] =
    useState<PlanInput["ownerPrefs"]["strategy"]>("balanced");
  const [horizonDays, setHorizonDays] = useState<number>(7);
  // Draft text value so typing is smooth (like inventory inputs)
  const [horizonDaysDraft, setHorizonDaysDraft] = useState<string>("7");

  const [paymentIntent, setPaymentIntent] = useState<any>(null);
  const [executeResp, setExecuteResp] = useState<any>(null);

  const [editingPlan, setEditingPlan] = useState(false);

  const [strategyDraft, setStrategyDraft] =
    useState<PlanInput["ownerPrefs"]["strategy"]>("balanced");

  const [priceBySku, setPriceBySku] = useState<Record<string, number>>({});
  const [uomBySku, setUomBySku] = useState<Record<string, string>>({});

  // --- AI Autonomy (same UX as old homepage) ---
  const [requireApproval, setRequireApproval] = useState<boolean | null>(null);
  const [isTogglingMode, setIsTogglingMode] = useState(false);

  const [agentEnabled, setAgentEnabled] = useState<boolean | null>(null);
  const [isEnablingAgent, setIsEnablingAgent] = useState(false);
  const attemptedEnableRef = useRef<string>("");

  const [showAutonomyInfo, setShowAutonomyInfo] = useState(false);
  const autonomyInfoWrapRef = useRef<HTMLDivElement | null>(null);

  const [showContextEditor, setShowContextEditor] = useState(false);

  // -------------------------
  // On-chain orders (grouped by intent ref)
  // -------------------------
  // -------------------------
  // Executed order receipts (from /api/orders/list; source=backend_receipts)
  // -------------------------
  type OrderLine = {
    sku: string;
    name?: string;
    qty: number;
    uom?: string;
  };

  type IntentItem = {
    orderId: string;
    supplier: string;
    amount: string; // raw token amount (18 decimals assumed)
    executeAfter?: number; // unix seconds (optional; can fall back to intent.executeAfter)
    lines: OrderLine[];

    // optional receipt-ish fields (won't break if present/absent)
    txHash?: string;
    createdAtUnix?: number;
    to?: string;
  };

  type IntentRow = {
    ref: string; // bytes32
    owner: string;
    restaurantId: string; // bytes32
    executeAfter?: number; // unix seconds
    approved?: boolean;
    executed?: boolean;
    canceled?: boolean;
    items: IntentItem[];
  };

  type PlannedOrder = {
    id: string; // local id
    createdAtMs: number;

    env: "testing" | "production";
    owner: string;
    locationId: string;

    // for display
    intent: IntentRow;

    // what we’ll execute later
    calls: { to: string; data: string }[];
  };

  function plannedKey(env: string, owner: string, locationId: string) {
    return `mozi_planned_orders:${env}:${owner.toLowerCase()}:${locationId}`;
  }

  type DemoOrderTimeSnapshot = {
    execUnix: number; // fixed demo execution time (unix seconds)
    etaBySupplier: Record<string, number>; // supplierAddrLower -> fixed eta unix
  };

  type DemoOrderTimeMap = Record<string, DemoOrderTimeSnapshot>;

  function demoReceivedKey(
    env: string,
    owner: string,
    locationId: string,
    intentRef: string,
    supplierAddr: string
  ) {
    return `mozi_demo_received:${env}:${owner.toLowerCase()}:${locationId}:${intentRef}:${supplierAddr.toLowerCase()}`;
  }

  function hasDemoReceived(
    env: string,
    owner: string,
    locationId: string,
    intentRef: string,
    supplierAddr: string
  ) {
    if (typeof window === "undefined") return false;
    return (
      window.localStorage.getItem(
        demoReceivedKey(env, owner, locationId, intentRef, supplierAddr)
      ) === "1"
    );
  }

  function markDemoReceived(
    env: string,
    owner: string,
    locationId: string,
    intentRef: string,
    supplierAddr: string
  ) {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      demoReceivedKey(env, owner, locationId, intentRef, supplierAddr),
      "1"
    );
  }

  function demoOrderTimesKey(env: string, owner: string, locationId: string) {
    return `mozi_demo_order_times:${env}:${owner.toLowerCase()}:${locationId}`;
  }

  function demoPipelineDecKey(env: string, owner: string, locationId: string) {
    return `mozi_demo_pipeline_decrement:${env}:${owner.toLowerCase()}:${locationId}`;
  }

  function loadDemoOrderTimes(
    env: string,
    owner: string,
    locationId: string
  ): DemoOrderTimeMap {
    if (typeof window === "undefined") return {};
    try {
      const raw = window.localStorage.getItem(
        demoOrderTimesKey(env, owner, locationId)
      );
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object"
        ? (parsed as DemoOrderTimeMap)
        : {};
    } catch {
      return {};
    }
  }

  function saveDemoOrderTimes(
    env: string,
    owner: string,
    locationId: string,
    map: DemoOrderTimeMap
  ) {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        demoOrderTimesKey(env, owner, locationId),
        JSON.stringify(map)
      );
    } catch {
      // ignore
    }
  }

  function loadPlanned(
    env: string,
    owner: string,
    locationId: string
  ): PlannedOrder[] {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(
        plannedKey(env, owner, locationId)
      );
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function savePlanned(
    env: string,
    owner: string,
    locationId: string,
    items: PlannedOrder[]
  ) {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      plannedKey(env, owner, locationId),
      JSON.stringify(items)
    );
  }

  type ChatMsg = { role: "user" | "assistant"; content: string };

  type AdditionalContextItem = {
    id: string; // stable key for remove
    text: string; // the context text
    durationDays: number; // how long it applies
    createdAtMs: number; // when it was saved
  };

  function additionalContextKey(
    env: string,
    owner: string,
    locationId: string
  ) {
    return `mozi_additional_context:${env}:${owner.toLowerCase()}:${locationId}`;
  }

  function autonomyEnforcedKey(env: string, owner: string, locationId: string) {
    return `mozi_autonomy_enforced:${env}:${owner.toLowerCase()}:${locationId}`;
  }

  function hasEnforcedAutonomy(env: string, owner: string, locationId: string) {
    if (typeof window === "undefined") return false;
    return (
      window.localStorage.getItem(
        autonomyEnforcedKey(env, owner, locationId)
      ) === "1"
    );
  }

  function markEnforcedAutonomy(
    env: string,
    owner: string,
    locationId: string
  ) {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      autonomyEnforcedKey(env, owner, locationId),
      "1"
    );
  }

  function loadAdditionalContext(
    env: string,
    owner: string,
    locationId: string
  ) {
    if (typeof window === "undefined") return [] as AdditionalContextItem[];
    try {
      const raw = window.localStorage.getItem(
        additionalContextKey(env, owner, locationId)
      );
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? (parsed as AdditionalContextItem[]) : [];
    } catch {
      return [] as AdditionalContextItem[];
    }
  }

  function saveAdditionalContext(
    env: string,
    owner: string,
    locationId: string,
    items: AdditionalContextItem[]
  ) {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      additionalContextKey(env, owner, locationId),
      JSON.stringify(items)
    );
  }

  function isContextActive(item: AdditionalContextItem) {
    const d = Number(item.durationDays ?? 0);

    // ✅ durationDays === 0 means indefinite (always active)
    if (d === 0) return true;

    if (!Number.isFinite(d) || d < 0) return false;

    const expiresAt = item.createdAtMs + d * 24 * 60 * 60 * 1000;
    return appNowMs() < expiresAt;
  }

  function formatContextForNotes(items: AdditionalContextItem[]) {
    const active = items.filter(isContextActive);
    if (active.length === 0) return "";
    return active
      .map((it) => `- ${it.text} (applies ${it.durationDays}d)`)
      .join("\n");
  }

  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [chatDraft, setChatDraft] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string>("");

  const [chatOpen, setChatOpen] = useState(false);

  // persistent notes for future orders (NOT purchase-plan notes)
  const [chatMemory, setChatMemory] = useState<string>("");

  // Additional Context items (saved one-by-one)
  const [additionalContext, setAdditionalContext] = useState<
    AdditionalContextItem[]
  >([]);

  const [contextListOpen, setContextListOpen] = useState(false);

  // Draft inputs
  const [contextDraft, setContextDraft] = useState("");
  const [contextDaysDraft, setContextDaysDraft] = useState("7");
  const [contextIndefDraft, setContextIndefDraft] = useState(false);

  useEffect(() => {
    if (additionalContext.length > 0) setContextListOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId]);

  useEffect(() => {
    function onDown(e: MouseEvent | TouchEvent) {
      if (!showAutonomyInfo) return;
      const el = autonomyInfoWrapRef.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      setShowAutonomyInfo(false);
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setShowAutonomyInfo(false);
    }

    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [showAutonomyInfo]);

  useEffect(() => {
    if (!editingPlan) setStrategyDraft(strategy);
  }, [strategy, editingPlan]);

  useEffect(() => {
    if (!editingPlan) setHorizonDaysDraft(String(horizonDays));
  }, [horizonDays, editingPlan]);

  useEffect(() => {
    const owner = getSavedOwnerAddress();
    const env = getSavedEnv();
    if (!owner || !locationId) return;

    const items = loadAdditionalContext(env, owner, locationId);
    setAdditionalContext(items);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId]);

  useEffect(() => {
    const owner = getSavedOwnerAddress();
    const env = getSavedEnv();
    if (!locationId || !owner || !isAddress(owner)) return;

    // Wait until we've actually read requireApproval from chain
    if (requireApproval === null) return;

    // Already autonomous => mark it and (optionally) ensure agent
    if (requireApproval === false) {
      if (!hasEnforcedAutonomy(env, owner, locationId)) {
        markEnforcedAutonomy(env, owner, locationId);
      }
      // optional: ensure agent is enabled too
      void ensureAgentEnabled(owner, locationId);
      return;
    }

    // requireApproval === true (Manual) -> flip to Autonomous ONCE (will prompt MetaMask once)
    if (requireApproval === true) {
      if (hasEnforcedAutonomy(env, owner, locationId)) return; // don't spam prompts
      markEnforcedAutonomy(env, owner, locationId);

      (async () => {
        try {
          // Flip execution mode to Autonomous (requireApproval=false)
          await setAutonomy(true);

          // Also ensure the agent is enabled (if your autonomous flow needs it)
          await ensureAgentEnabled(owner, locationId);
        } catch (e) {
          // If user rejects tx, allow them to retry later by clearing the flag:
          // (otherwise they'd be stuck in manual forever)
          try {
            window.localStorage.removeItem(
              autonomyEnforcedKey(env, owner, locationId)
            );
          } catch {}
        }
      })();
    }
  }, [locationId, requireApproval]); // intentionally depends on requireApproval

  async function sendChat() {
    const owner = getSavedOwnerAddress();
    const env = getSavedEnv();

    if (!owner || !isAddress(owner)) {
      setChatError("No valid wallet found. Connect wallet on homepage first.");
      return;
    }
    if (!locationId) return;

    const msg = chatDraft.trim();
    if (!msg) return;

    setChatError("");
    setChatLoading(true);

    // optimistic append user message
    const nextThread: ChatMsg[] = [
      ...chatMessages,
      { role: "user", content: msg },
    ];
    setChatMessages(nextThread);
    setChatDraft("");

    try {
      // optional but strong: give the chat a snapshot of your restaurant state
      // (THIS DOES NOT create a plan. It's just context.)
      let restaurantContext: any = null;
      try {
        const stateRes = await fetch(
          `/api/state?locationId=${encodeURIComponent(locationId)}` +
            `&owner=${encodeURIComponent(owner)}` +
            `&env=${encodeURIComponent(env)}`
        );
        if (stateRes.ok) restaurantContext = await stateRes.json();
      } catch {
        restaurantContext = null;
      }

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerAddress: owner,
          env,
          locationId,
          restaurantContext,
          memory: formatContextForNotes(additionalContext),
          messages: nextThread.slice(-16),
          userMessage: msg,
        }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setChatError(
          `CHAT HTTP ${res.status}\n` + JSON.stringify(json, null, 2)
        );
        return;
      }

      const reply = String(json.reply ?? "");
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: reply },
      ]);

      // If model suggests durable info, append it to saved notes.
      if (typeof json.memoryAppend === "string" && json.memoryAppend.trim()) {
        const nowMs = appNowMs();
        const nextItem: AdditionalContextItem = {
          id: `${nowMs}_${Math.random().toString(16).slice(2)}`,
          text: json.memoryAppend.trim(),
          durationDays: 7,
          createdAtMs: nowMs,
        };

        setAdditionalContext((prev) => {
          const next = [nextItem, ...prev];
          saveAdditionalContext(env, owner, locationId, next);
          return next;
        });
      }
    } catch (e: any) {
      setChatError(String(e?.message ?? e));
    } finally {
      setChatLoading(false);
    }
  }

  const [plannedOrders, setPlannedOrders] = useState<PlannedOrder[]>([]);
  const [planningLoading, setPlanningLoading] = useState(false);
  const [executingPlannedId, setExecutingPlannedId] = useState<string | null>(
    null
  );

  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState<string>("");
  const [intents, setIntents] = useState<IntentRow[]>([]);

  // which order cards are expanded (keyed by grouped order key)
  const [openOrderKeys, setOpenOrderKeys] = useState<Record<string, boolean>>(
    {}
  );

  // --- Planned order editing (inline in dropdown) ---
  const [editingPlannedId, setEditingPlannedId] = useState<string | null>(null);

  // plannedId -> rowKey -> draftQty
  const [plannedQtyDrafts, setPlannedQtyDrafts] = useState<
    Record<string, Record<string, string>>
  >({});

  // Supplier display map: payoutAddress(lower) -> { name, address }
  // Supplier display map: payoutAddress(lower) -> { name, address, leadTimeDays }
  const [supplierByAddress, setSupplierByAddress] = useState<
    Record<string, { name: string; address: string; leadTimeDays: number }>
  >({});

  const [demoOrderTimes, setDemoOrderTimes] = useState<DemoOrderTimeMap>({});
  type PipelineDecMap = Record<string, number>; // sku -> units to subtract
  const [pipelineDecBySku, setPipelineDecBySku] = useState<PipelineDecMap>({});

  const advanceDayInFlightRef = useRef(false);
  const [advanceDayBusy, setAdvanceDayBusy] = useState(false);

  // --- Frontend-only "effective" pipeline stats (subtract units that have arrived in demo time) ---
  function getEffectivePipelineUnits(p: any, dec: number) {
    const inbound = Math.max(
      0,
      Number(p?.inboundWithinHorizonUnits ?? 0) - dec
    );
    const nonArrived = Math.max(
      0,
      Number(p?.pipelineAllNonArrivedUnits ?? 0) - dec
    );
    return {
      inboundWithinHorizonUnits: inbound,
      pipelineAllNonArrivedUnits: nonArrived,
    };
  }

  function supplierLabel(addr: string) {
    const key = String(addr || "").toLowerCase();
    const hit = supplierByAddress[key];
    return {
      name: hit?.name ?? "Unknown supplier",
      address: addr,
      leadTimeDays: Number.isFinite(hit?.leadTimeDays as any)
        ? Number(hit?.leadTimeDays)
        : 0,
    };
  }

  function fmtCostUsdFromRawAmount(raw: string) {
    try {
      // Assumption in your codebase: 18 decimals and 1 token ~= $1
      const usd = Number(formatUnits(BigInt(raw), 18));
      if (!Number.isFinite(usd)) return "—";
      return usd.toFixed(2);
    } catch {
      return "—";
    }
  }

  // re-render once per second for execution countdown timers

  const lastOrdersAutoUpdateAt = useRef(0);

  // auto-update interval (12 hours) - for automatic on-chain order syncs
  const ordersAutoUpdateIntervalMs = 12 * 60 * 60 * 1000; // 12 hours

  // Manual vs Autonomous (from chain)
  const [modeLoading, setModeLoading] = useState(false);

  async function refreshExecutionMode() {
    const owner = getSavedOwnerAddress();
    if (!owner || !isAddress(owner)) {
      setRequireApproval(null);
      return;
    }

    try {
      const injected = getInjectedProvider();
      if (!injected) {
        setRequireApproval(null);
        return;
      }

      if (!TREASURY_HUB_ADDRESS || !isAddress(TREASURY_HUB_ADDRESS)) {
        setRequireApproval(null);
        return;
      }

      // READ-ONLY: do NOT request accounts for a view call
      const provider = new BrowserProvider(injected);
      const hub = new Contract(
        TREASURY_HUB_ADDRESS,
        MOZI_TREASURY_HUB_ABI,
        provider
      );

      const required = (await (hub as any).requireApprovalForExecution(
        owner
      )) as boolean;

      setRequireApproval(Boolean(required));
    } catch {
      setRequireApproval(null);
    }
  }

  async function refreshAutonomyFromChain(ownerAddress: string) {
    try {
      const hubAddr = process.env.NEXT_PUBLIC_MOZI_TREASURY_HUB_ADDRESS ?? "";
      const agentAddr = process.env.NEXT_PUBLIC_MOZI_AGENT_ADDRESS ?? "";

      if (!hubAddr || !isAddress(hubAddr)) {
        setRequireApproval(null);
        setAgentEnabled(null);
        return;
      }

      // You should already have a provider on this page; if not, this is the same pattern as old homepage
      const ethereum = (window as any).ethereum;
      if (!ethereum) return;

      const provider = new BrowserProvider(ethereum);
      const hub = new Contract(hubAddr, MOZI_TREASURY_HUB_ABI, provider);

      const agentOk = agentAddr ? isAddress(agentAddr) : false;

      const [reqApproval, allowed] = await Promise.all([
        (hub as any).requireApprovalForExecution(
          ownerAddress
        ) as Promise<boolean>,
        agentOk
          ? ((hub as any).isAgentFor(
              ownerAddress,
              agentAddr
            ) as Promise<boolean>)
          : Promise.resolve(false),
      ]);

      setRequireApproval(Boolean(reqApproval));
      setAgentEnabled(Boolean(allowed));
    } catch {
      setRequireApproval(null);
      setAgentEnabled(null);
    }
  }
  async function setExecutionMode(
    nextAutonomous: boolean,
    ownerAddress: string
  ) {
    const hubAddr = process.env.NEXT_PUBLIC_MOZI_TREASURY_HUB_ADDRESS ?? "";
    if (!hubAddr || !isAddress(hubAddr)) return;

    try {
      setIsTogglingMode(true);

      const ethereum = (window as any).ethereum;
      if (!ethereum) return;

      const provider = new BrowserProvider(ethereum);
      const signer = await provider.getSigner();

      const hub = new Contract(hubAddr, MOZI_TREASURY_HUB_ABI, signer);

      // Manual = requireApprovalForExecution(true)
      // Autonomous = requireApprovalForExecution(false)
      const nextRequired = !nextAutonomous;

      const tx = await (hub as any).setRequireApprovalForExecution(
        nextRequired
      );
      await tx.wait();

      await refreshAutonomyFromChain(ownerAddress);
    } finally {
      setIsTogglingMode(false);
    }
  }
  async function ensureAgentEnabled(ownerAddress: string, locationId: string) {
    const hubAddr = process.env.NEXT_PUBLIC_MOZI_TREASURY_HUB_ADDRESS ?? "";
    const agentAddr = process.env.NEXT_PUBLIC_MOZI_AGENT_ADDRESS ?? "";
    if (!hubAddr || !agentAddr) return;
    if (!isAddress(hubAddr) || !isAddress(agentAddr)) return;

    // only attempt once per owner+location
    const attemptKey = `${ownerAddress.toLowerCase()}:${locationId}`;
    if (attemptedEnableRef.current === attemptKey) return;
    if (agentEnabled === true) {
      attemptedEnableRef.current = attemptKey;
      return;
    }

    try {
      setIsEnablingAgent(true);

      const ethereum = (window as any).ethereum;
      if (!ethereum) return;

      const provider = new BrowserProvider(ethereum);
      const signer = await provider.getSigner();
      const hub = new Contract(hubAddr, MOZI_TREASURY_HUB_ABI, signer);

      const allowed = (await (hub as any).isAgentFor(
        ownerAddress,
        agentAddr
      )) as boolean;

      if (allowed) {
        setAgentEnabled(true);
        attemptedEnableRef.current = attemptKey;
        return;
      }

      const tx = await (hub as any).setAgent(agentAddr, true);
      await tx.wait();

      attemptedEnableRef.current = attemptKey;
      await refreshAutonomyFromChain(ownerAddress);
    } finally {
      setIsEnablingAgent(false);
    }
  }

  async function setAutonomy(enabled: boolean) {
    // enabled=true => Autonomous => requireApproval=false
    const owner = getSavedOwnerAddress();
    if (!owner || !isAddress(owner)) {
      setOrdersError(
        "No valid wallet found. Connect wallet on homepage first."
      );
      return;
    }

    try {
      setModeLoading(true);
      setOrdersError("");

      const { hub } = await getSignerAndHub();
      const tx = await hub.setRequireApprovalForExecution(!enabled);
      await tx.wait();

      await refreshExecutionMode();
      await refreshOrders(); // optional: keeps UI in sync
    } catch (e: any) {
      setOrdersError(String(e?.message ?? e));
    } finally {
      setModeLoading(false);
    }
  }

  // UI state for approve button
  const [approvingRef, setApprovingRef] = useState<string | null>(null);

  // UI state for deleting (canceling) a grouped order card
  const [cancelingOrderKey, setCancelingOrderKey] = useState<string | null>(
    null
  );

  // ✅ Global cancel mutex (prevents MetaMask glitches from concurrent cancels)
  const cancelAnyInFlight = useRef(false);
  const [cancelAnyUi, setCancelAnyUi] = useState(false);

  // -------------------------
  // Auto-propose (periodic)
  // -------------------------
  const autoProposeInFlight = useRef(false);
  const refreshOrdersInFlight = useRef(false);
  const manualGenerateInFlight = useRef(false);

  function getSavedEnv(): "testing" | "production" {
    if (typeof window === "undefined") return "testing";
    const v = window.localStorage.getItem("mozi_env");
    return v === "production" ? "production" : "testing";
  }

  function getInjectedProvider() {
    if (typeof window === "undefined") return null;
    const eth = (window as any).ethereum;
    if (!eth) return null;

    // If multiple injected providers exist, prefer MetaMask
    const providers: any[] = Array.isArray(eth.providers) ? eth.providers : [];
    const mm = providers.find((p) => p && p.isMetaMask);
    return mm ?? eth;
  }

  async function getSignerAndHub() {
    const injected = getInjectedProvider();
    if (!injected) throw new Error("No injected wallet found (MetaMask).");

    if (!TREASURY_HUB_ADDRESS || !isAddress(TREASURY_HUB_ADDRESS)) {
      throw new Error("Missing/invalid NEXT_PUBLIC_MOZI_TREASURY_HUB_ADDRESS");
    }

    const provider = new BrowserProvider(injected);
    // prompts connect if needed
    await provider.send("eth_requestAccounts", []);
    const signer = await provider.getSigner();

    const hub = new Contract(
      TREASURY_HUB_ADDRESS,
      MOZI_TREASURY_HUB_ABI,
      signer
    );

    return { signer, hub };
  }

  async function approveIntent(ref: string) {
    if (!ref) return;

    try {
      setApprovingRef(ref);
      const { hub } = await getSignerAndHub();

      // NOTE: this assumes your hub ABI exposes approveIntent(bytes32)
      const tx = await hub.approveIntent(ref);
      await tx.wait();

      await refreshOrders();
    } catch (e: any) {
      setOrdersError(String(e?.message ?? e));
    } finally {
      setApprovingRef(null);
    }
  }

  async function cancelIntentCard(intent: IntentRow) {
    const key = String(intent?.ref || "");
    if (!key) return;

    // already canceling something → ignore
    if (cancelAnyInFlight.current) return;

    try {
      cancelAnyInFlight.current = true;
      setCancelAnyUi(true);
      setCancelingOrderKey(key);

      const { hub } = await getSignerAndHub();

      // NOTE: this assumes your hub ABI exposes cancelIntent(bytes32)
      const tx = await hub.cancelIntent(key);
      await tx.wait();

      // Immediately remove from UI (optimistic), then refresh canonical state.
      setIntents((prev) => prev.filter((x) => String(x.ref || "") !== key));

      await refreshOrders();
    } catch (e: any) {
      setOrdersError(String(e?.message ?? e));
      // if cancel failed, refresh to restore correct UI
      await refreshOrders().catch(() => {});
    } finally {
      setCancelingOrderKey(null);
      setCancelAnyUi(false);
      cancelAnyInFlight.current = false;
    }
  }

  function getSavedOwnerAddress(): string | null {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem("mozi_wallet_address");
  }

  function fmtWhen(ts: number) {
    if (!ts) return "—";
    try {
      // ts is unix seconds; independent of demo clock, but we still want displayed times
      return new Date(ts * 1000).toLocaleString();
    } catch {
      return String(ts);
    }
  }

  function getFixedEtaUnixForRow(
    snapshotKey: string,
    supplierAddr: string,
    execUnix: number
  ) {
    const supAddrLower = String(supplierAddr || "").toLowerCase();
    const snap = demoOrderTimes[snapshotKey];

    // 1) Preferred: frozen ETA stored in localStorage snapshot map
    const frozen = snap?.etaBySupplier?.[supAddrLower];
    if (Number.isFinite(frozen) && (frozen as number) > 0)
      return Number(frozen);

    // 2) Fallback: derive ETA from execUnix + lead days (still deterministic)
    const leadDays = Math.max(
      0,
      Number(supplierLabel(supAddrLower).leadTimeDays ?? 0) || 0
    );
    return Number(execUnix || 0) + leadDays * 24 * 60 * 60;
  }

  function formatCountdown(secondsRemaining: number) {
    // secondsRemaining can be fractional/negative; normalize
    const s = Math.floor(secondsRemaining);

    if (!Number.isFinite(s)) return "—";
    if (s <= 0) return "Arrived";

    const DAY = 24 * 60 * 60;
    const HOUR = 60 * 60;
    const MIN = 60;

    const d = Math.floor(s / DAY);
    const h = Math.floor((s % DAY) / HOUR);
    const m = Math.floor((s % HOUR) / MIN);
    const sec = s % MIN;

    // Keep it clean:
    // - Far away: "3d 2h"
    // - Medium:   "5h 12m"
    // - Soon:     "30m"
    // - Very soon:"4m 15s"
    // - Imminent: "15s"
    if (d >= 1) return `${d}d${h ? ` ${h}h` : ""}`;
    if (h >= 1) return `${h}h${m ? ` ${m}m` : ""}`;
    if (m >= 10) return `${m}m`; // avoid clutter for medium-short
    if (m >= 1) return `${m}m ${sec}s`; // show seconds only when close
    return `${sec}s`;
  }

  function persistPipelineDec(next: PipelineDecMap) {
    const owner = getSavedOwnerAddress();
    const env = getSavedEnv();
    if (!locationId || !owner) return;

    try {
      window.localStorage.setItem(
        demoPipelineDecKey(env, owner, locationId),
        JSON.stringify(next)
      );
    } catch {}
  }

  const [state, setState] = useState<any>(null);
  const [stateLoading, setStateLoading] = useState(false);

  async function refreshState() {
    const owner = getSavedOwnerAddress();
    const env = getSavedEnv();

    if (!locationId || !owner || !isAddress(owner)) {
      setState(null);
      return;
    }

    setStateLoading(true);
    try {
      const url =
        `/api/state?locationId=${encodeURIComponent(locationId)}` +
        `&owner=${encodeURIComponent(owner)}` +
        `&env=${encodeURIComponent(env)}`;

      const { res, json } = await fetchJsonWithTimeout(
        url,
        { method: "GET" },
        12_000
      );

      if (!res.ok) {
        console.warn("state refresh failed", res.status, json);
        return;
      }

      setState(json);
    } catch (e) {
      console.warn("state refresh error", e);
    } finally {
      setStateLoading(false);
    }
  }

  async function refreshOrders() {
    if (cancelAnyInFlight.current) return;

    // Prevent overlapping refreshes
    if (refreshOrdersInFlight.current) return;

    refreshOrdersInFlight.current = true;

    const owner = getSavedOwnerAddress();
    const env = getSavedEnv();

    if (!owner || !isAddress(owner)) {
      setIntents([]);
      setOrdersError(
        "No valid wallet found. Go to the homepage, connect wallet, then come back."
      );
      refreshOrdersInFlight.current = false;
      return;
    }

    if (!locationId) {
      setIntents([]);
      setOrdersError("Missing locationId.");
      refreshOrdersInFlight.current = false;
      return;
    }

    setOrdersLoading(true);
    setOrdersError("");

    try {
      const url =
        `/api/orders/list?env=${encodeURIComponent(env)}` +
        `&owner=${encodeURIComponent(owner)}` +
        `&locationId=${encodeURIComponent(locationId)}` +
        `&limit=200`;

      const TIMEOUT_MS = 12_000;
      const RETRY_DELAY_MS = 800;

      let res: Response;
      let json: any;

      ({ res, json } = await fetchJsonWithTimeout(
        url,
        { method: "GET" },
        TIMEOUT_MS
      ));

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

      // In receipts mode, server already filtered by owner/locationId,
      // and there is no canceled item concept. Just keep non-empty.
      const cleaned = raw.filter(
        (it) => Array.isArray(it.items) && it.items.length > 0
      );

      setIntents(cleaned);
      // ✅ Snapshot fixed demo execution/arrival times per order (frontend-only)
      try {
        const env2 = env; // already in scope
        const owner2 = owner; // already in scope
        const loc2 = locationId; // already in scope

        setDemoOrderTimes((prev) => {
          const next: DemoOrderTimeMap = { ...(prev || {}) };

          for (const it of cleaned) {
            const key = String(it?.ref || "");
            if (!key) continue;

            // already have a snapshot -> keep it unchanged forever
            if (next[key]?.execUnix) continue;

            const execUnix = demoNowUnix(); // ✅ snapshot "demo now" at first sight

            // compute per-supplier fixed ETA using supplier lead times
            const etaBySupplier: Record<string, number> = {};
            const items = Array.isArray(it?.items) ? it.items : [];

            for (const item of items) {
              const supAddr = String(item?.supplier || "").toLowerCase();
              if (!supAddr) continue;

              const sup = supplierLabel(supAddr);
              const leadDays = Math.max(0, Number(sup.leadTimeDays ?? 0) || 0);

              etaBySupplier[supAddr] = execUnix + leadDays * 24 * 60 * 60;
            }

            next[key] = { execUnix, etaBySupplier };
          }

          saveDemoOrderTimes(env2, owner2, loc2, next);
          return next;
        });
      } catch {
        // ignore
      }
    } catch (e: any) {
      setIntents([]);
      setRequireApproval(null);
      setOrdersError(String(e?.message ?? e));
    } finally {
      setOrdersLoading(false);
      refreshOrdersInFlight.current = false;
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

  const btnLink = (disabled?: boolean): React.CSSProperties => ({
    border: "none",
    background: "transparent",
    padding: 0,
    color: COLORS.primary,
    fontWeight: 900,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
  });

  const readRow: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "1fr auto",
    alignItems: "center",
    gap: 12,
    padding: "6px 0",
    minWidth: 0,
  };

  const valuePill = (bg = "rgba(15,23,42,0.06)"): React.CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    padding: "6px 10px",
    borderRadius: 999,
    background: bg,
    color: COLORS.text,
    fontWeight: 900,
    fontSize: 13,
    lineHeight: 1,
    whiteSpace: "nowrap",
    justifySelf: "end",
  });

  const receiveInFlightRef = useRef(false);

  async function receiveInventory(lines: { sku: string; units: number }[]) {
    if (!locationId) return;
    if (receiveInFlightRef.current) return;

    const env = getSavedEnv();
    const owner = getSavedOwnerAddress();
    if (!owner || !isAddress(owner)) return;

    const cleaned = (lines || [])
      .map((l) => ({
        sku: String(l?.sku ?? "").trim(),
        units: Math.max(0, Math.floor(Number(l?.units ?? 0))),
      }))
      .filter((l) => l.sku && l.units > 0);

    if (cleaned.length === 0) return;

    receiveInFlightRef.current = true;
    try {
      const { res, json } = await fetchJsonWithTimeout(
        `/api/inventory/receive?locationId=${encodeURIComponent(locationId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lines: cleaned }),
        },
        12_000
      );

      if (!res.ok || !json?.ok) {
        console.warn("receive failed", res.status, json);
        return; // ✅ IMPORTANT: do NOT decrement pipeline if receive failed
      }

      // ✅ NEW: decrement pipeline stats in demo mode (persisted)
      const storageKey = demoPipelineDecKey(env, owner, locationId);
      setPipelineDecBySku((prev) => {
        const next: Record<string, number> = { ...(prev ?? {}) };
        for (const l of cleaned) {
          next[l.sku] = Math.max(0, Math.floor((next[l.sku] ?? 0) + l.units));
        }
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {}
        return next;
      });
    } finally {
      receiveInFlightRef.current = false;
    }
  }

  function newlyArrivedUnitsBySku(nowUnix: number): Record<string, number> {
    const env = getSavedEnv();
    const owner = getSavedOwnerAddress();
    if (!locationId || !owner || !isAddress(owner)) return {};

    const out: Record<string, number> = {};

    const allIntents: IntentRow[] = [
      ...plannedOrders.map((p) => ({
        ...(p.intent as any),
        ref: `planned:${p.id}`,
      })),
      ...intents,
    ];

    for (const intent of allIntents) {
      const intentRef = String(intent?.ref || "");
      if (!intentRef) continue;

      const items = Array.isArray(intent?.items) ? intent.items : [];
      if (items.length === 0) continue;

      const supplierAddrs = Array.from(
        new Set(items.map((it) => String(it?.supplier || "").toLowerCase()))
      ).filter(Boolean);

      const snap = demoOrderTimes[intentRef];
      const execUnix =
        Number(snap?.execUnix ?? 0) ||
        Number(
          (intent as any).createdAtUnix ??
            (items[0] as any)?.createdAtUnix ??
            intent.executeAfter ??
            0
        );

      for (const supAddrLower of supplierAddrs) {
        // only count if it *wasn't* received before, but *is* arrived now
        if (hasDemoReceived(env, owner, locationId, intentRef, supAddrLower))
          continue;

        const etaUnix = getFixedEtaUnixForRow(
          intentRef,
          supAddrLower,
          execUnix
        );
        if (!etaUnix || nowUnix < etaUnix) continue;

        for (const it of items) {
          if (String(it?.supplier || "").toLowerCase() !== supAddrLower)
            continue;

          const lines = Array.isArray((it as any).lines)
            ? (it as any).lines
            : [];
          for (const ln of lines) {
            const sku = String(ln?.sku || ln?.skuId || "").trim();
            const qty = Math.max(
              0,
              Math.floor(Number(ln?.qty ?? ln?.units ?? ln?.quantity ?? 0) || 0)
            );
            if (!sku || qty <= 0) continue;
            out[sku] = (out[sku] ?? 0) + qty;
          }
        }
      }
    }

    return out;
  }

  async function applyArrivalsNowUnix(nowUnix: number) {
    if (!locationId) return;

    const env = getSavedEnv();
    const owner = getSavedOwnerAddress();
    if (!owner || !isAddress(owner)) return;

    // Apply receipts for BOTH:
    // - planned intents (ref = planned:<id>)
    // - chain intents (ref = bytes32)
    const allIntents: IntentRow[] = [
      ...plannedOrders.map((p) => ({
        ...(p.intent as any),
        ref: `planned:${p.id}`,
      })),
      ...intents,
    ];

    for (const intent of allIntents) {
      const intentRef = String(intent?.ref || "");
      if (!intentRef) continue;

      const items = Array.isArray(intent?.items) ? intent.items : [];
      if (items.length === 0) continue;

      const supplierAddrs = Array.from(
        new Set(items.map((it) => String(it?.supplier || "").toLowerCase()))
      ).filter(Boolean);

      for (const supAddrLower of supplierAddrs) {
        // already applied -> skip
        if (hasDemoReceived(env, owner, locationId, intentRef, supAddrLower))
          continue;

        // exec time: prefer frozen snapshot, else fallback to receipt fields
        const snap = demoOrderTimes[intentRef];
        const execUnix =
          Number(snap?.execUnix ?? 0) ||
          Number(
            (intent as any).createdAtUnix ??
              (items[0] as any)?.createdAtUnix ??
              intent.executeAfter ??
              0
          );

        const etaUnix = getFixedEtaUnixForRow(
          intentRef,
          supAddrLower,
          execUnix
        );
        if (!etaUnix || nowUnix < etaUnix) continue;

        // Build receive lines for that supplier
        const receiveLines: { sku: string; units: number }[] = [];

        for (const it of items) {
          const itSup = String(it?.supplier || "").toLowerCase();
          if (itSup !== supAddrLower) continue;

          const lines = Array.isArray((it as any).lines)
            ? (it as any).lines
            : [];
          for (const ln of lines) {
            const sku = String(ln?.sku || ln?.skuId || "").trim();
            const qty = Math.max(
              0,
              Math.floor(Number(ln?.qty ?? ln?.units ?? ln?.quantity ?? 0) || 0)
            );
            if (sku && qty > 0) receiveLines.push({ sku, units: qty });
          }
        }

        if (receiveLines.length === 0) {
          // still mark received so we don't loop forever on empty lines
          markDemoReceived(env, owner, locationId, intentRef, supAddrLower);
          continue;
        }

        // combine duplicates
        const bySku = new Map<string, number>();
        for (const l of receiveLines) {
          bySku.set(l.sku, (bySku.get(l.sku) ?? 0) + l.units);
        }
        const combined = Array.from(bySku.entries()).map(([sku, units]) => ({
          sku,
          units,
        }));

        // Mark first (prevents double-apply)
        markDemoReceived(env, owner, locationId, intentRef, supAddrLower);

        // Apply to server inventory immediately
        await receiveInventory(combined);
      }
    }
  }

  async function planOrder() {
    if (!locationId) return;
    if (planningLoading) return;

    setPlanningLoading(true);
    setError("");
    try {
      const owner = getSavedOwnerAddress();
      const env = getSavedEnv();

      if (!owner || !isAddress(owner)) {
        setOrdersError(
          "No valid wallet found. Go to the homepage, connect wallet, then come back here."
        );
        return;
      }

      // 1) nonce
      const nonceRes = await fetch(
        `/api/auth/nonce?env=${encodeURIComponent(
          env
        )}&owner=${encodeURIComponent(owner)}&locationId=${encodeURIComponent(
          locationId
        )}`,
        { method: "GET" }
      );
      const nonceJson = await nonceRes.json().catch(() => null);
      if (!nonceRes.ok || !nonceJson?.ok) {
        setError(
          `NONCE HTTP ${nonceRes.status}\n` + JSON.stringify(nonceJson, null, 2)
        );
        return;
      }

      const nonce: string = String(nonceJson.nonce ?? "");
      const issuedAtMs: number = Number(nonceJson.issuedAtMs ?? Date.now());

      // 2) signature
      const injected = getInjectedProvider();
      if (!injected) {
        setError("No injected wallet found (MetaMask).");
        return;
      }

      const provider = new BrowserProvider(injected);
      await provider.send("eth_requestAccounts", []);
      const signer = await provider.getSigner();
      const signerAddr = await signer.getAddress();

      if (signerAddr.toLowerCase() !== owner.toLowerCase()) {
        setError(
          `Connected wallet (${signerAddr}) does not match saved owner (${owner}).`
        );
        return;
      }

      const message =
        `Mozi: Plan Order\n` +
        `env: ${env}\n` +
        `locationId: ${locationId}\n` +
        `owner: ${owner}\n` +
        `nonce: ${nonce}\n` +
        `issuedAtMs: ${issuedAtMs}\n`;

      const signature = await signer.signMessage(message);

      // 3) plan (NO BROADCAST)
      const res = await fetch(
        `/api/orders/plan?locationId=${encodeURIComponent(locationId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            env,
            ownerAddress: owner,
            auth: { message, signature, nonce, issuedAtMs },
            strategy,
            horizonDays,
            notes: formatContextForNotes(additionalContext),
          }),
        }
      );

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setError(
          `PLAN ORDER HTTP ${res.status}\n` + JSON.stringify(json, null, 2)
        );
        return;
      }

      const nowMs = appNowMs();

      const planned: PlannedOrder = {
        id: `${nowMs}_${Math.random().toString(16).slice(2)}`,
        createdAtMs: nowMs,
        env,
        owner,
        locationId,
        intent: json.intent as IntentRow,
        calls: (json.calls ?? []) as { to: string; data: string }[],
      };

      setPlannedOrders(() => {
        const next = [planned]; // ✅ only one planned order allowed
        savePlanned(env, owner, locationId, next);
        return next;
      });
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setPlanningLoading(false);
    }
  }

  function cancelEditPlannedOrder(plannedId: string) {
    setEditingPlannedId((cur) => (cur === plannedId ? null : cur));
    setPlannedQtyDrafts((prev) => {
      const copy = { ...prev };
      delete copy[plannedId];
      return copy;
    });
  }

  function saveEditPlannedOrder(plannedId: string) {
    const owner = getSavedOwnerAddress();
    const env = getSavedEnv();
    if (!owner || !locationId) return;

    const draftsForPlanned = plannedQtyDrafts[plannedId] || {};

    setPlannedOrders((prev) => {
      const next = prev.map((p) => {
        if (p.id !== plannedId) return p;

        const intent: any = p.intent;
        const items = Array.isArray(intent?.items) ? intent.items : [];

        const nextItems = items.map((it: any) => {
          const lines = Array.isArray(it?.lines) ? it.lines : [];

          const nextLines = lines.map((ln: any, idx: number) => {
            const sku = String(ln?.sku || ln?.skuId || "");
            const orderId = String(it?.orderId || it?.id || "");
            const rowKey = `${orderId}:${sku}:${idx}`;

            const draft = draftsForPlanned[rowKey];
            if (draft == null) return ln;

            const n = parseInt(String(draft).replace(/[^\d]/g, ""), 10);
            const qty = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;

            return { ...ln, qty };
          });

          return { ...it, lines: nextLines };
        });

        return { ...p, intent: { ...intent, items: nextItems } };
      });

      savePlanned(env, owner, locationId, next);
      return next;
    });

    cancelEditPlannedOrder(plannedId);
  }

  function isUserRejected(e: any) {
    // MetaMask / EIP-1193 user rejected request
    const code = e?.code ?? e?.info?.error?.code;
    if (code === 4001) return true;

    const msg = String(e?.shortMessage ?? e?.message ?? "").toLowerCase();
    return (
      msg.includes("user rejected") ||
      msg.includes("rejected the request") ||
      msg.includes("denied") ||
      msg.includes("cancelled") ||
      msg.includes("canceled")
    );
  }

  async function generateOrders() {
    if (!locationId) return;

    if (manualGenerateInFlight.current) return;

    setOrdersError("");

    setLoading(true);
    manualGenerateInFlight.current = true;

    setOrdersError("");
    setPlan(null);
    setPaymentIntent(null);
    setExecuteResp(null);

    try {
      const owner = getSavedOwnerAddress();
      const env = getSavedEnv();

      if (!owner || !isAddress(owner)) {
        setOrdersError(
          "No valid wallet found. Go to the homepage, connect wallet, then come back here."
        );
        return;
      }

      // 1) Ask server for a nonce (prevents replay)
      const nonceRes = await fetch(
        `/api/auth/nonce?env=${encodeURIComponent(
          env
        )}&owner=${encodeURIComponent(owner)}&locationId=${encodeURIComponent(
          locationId
        )}`,
        { method: "GET" }
      );
      const nonceJson = await nonceRes.json().catch(() => null);
      if (!nonceRes.ok || !nonceJson?.ok) {
        setOrdersError(
          `NONCE HTTP ${nonceRes.status}\n` + JSON.stringify(nonceJson, null, 2)
        );
        return;
      }

      const nonce: string = String(nonceJson.nonce ?? "");
      const issuedAtMs: number = Number(nonceJson.issuedAtMs ?? Date.now());

      // 2) MetaMask signature gate (user sees a signature prompt)
      const injected = getInjectedProvider();
      if (!injected) {
        setOrdersError("No injected wallet found (MetaMask).");
        return;
      }

      const provider = new BrowserProvider(injected);
      await provider.send("eth_requestAccounts", []);
      const signer = await provider.getSigner();

      const signerAddr = await signer.getAddress();
      if (signerAddr.toLowerCase() !== owner.toLowerCase()) {
        setOrdersError(
          `Connected wallet (${signerAddr}) does not match saved owner (${owner}).`
        );
        return;
      }

      const message =
        `Mozi: Generate Orders\n` +
        `env: ${env}\n` +
        `locationId: ${locationId}\n` +
        `owner: ${owner}\n` +
        `nonce: ${nonce}\n` +
        `issuedAtMs: ${issuedAtMs}\n`;

      const signature = await signer.signMessage(message);

      // 3) Proceed with your existing server flow, but include signature proof
      const res = await fetch(
        `/api/orders/propose?locationId=${encodeURIComponent(locationId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            env,
            ownerAddress: owner,
            auth: { message, signature, nonce, issuedAtMs },
            pendingWindowHours: 0,
            strategy,
            horizonDays,
            notes: formatContextForNotes(additionalContext),

            // NEW: persist “execution time” as the simulated click moment
            clientExecUnix: demoNowUnix(),
          }),
        }
      );

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setOrdersError(
          `GENERATE ORDERS HTTP ${res.status}\n` + JSON.stringify(json, null, 2)
        );
        return;
      }

      await refreshOrders();
    } catch (e: any) {
      // ✅ If the user cancels the MetaMask signature prompt, don't show an error.
      if (isUserRejected(e)) return;

      setOrdersError(String(e?.message ?? e));
    } finally {
      manualGenerateInFlight.current = false;
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!locationId) return;

    const env = getSavedEnv();
    const owner = getSavedOwnerAddress();
    if (!owner || !isAddress(owner)) return;

    // Check every second (cheap), but only calls server when a new arrival is detected
    const t = window.setInterval(() => {
      try {
        const nowUnix = demoNowUnix();

        // We apply receipts for BOTH:
        // - chain intents (intent.ref is bytes32)
        // - planned intents (intent.ref is "planned:<id>")
        const allIntents: IntentRow[] = [
          ...plannedOrders.map((p) => ({
            ...(p.intent as any),
            ref: `planned:${p.id}`,
          })),
          ...intents,
        ];

        for (const intent of allIntents) {
          const intentRef = String(intent?.ref || "");
          if (!intentRef) continue;

          const items = Array.isArray(intent?.items) ? intent.items : [];
          if (items.length === 0) continue;

          // For each supplier in this intent, compute its ETA using your frozen snapshot map
          const supplierAddrs = Array.from(
            new Set(items.map((it) => String(it?.supplier || "").toLowerCase()))
          ).filter(Boolean);

          for (const supAddrLower of supplierAddrs) {
            // already applied -> skip
            if (
              hasDemoReceived(env, owner, locationId, intentRef, supAddrLower)
            )
              continue;

            // execUnix snapshot: use your existing frozen map if present
            const snap = demoOrderTimes[intentRef];
            const execUnix =
              Number(snap?.execUnix ?? 0) ||
              Number(
                (intent as any).createdAtUnix ??
                  (items[0] as any)?.createdAtUnix ??
                  intent.executeAfter ??
                  0
              );

            const etaUnix = getFixedEtaUnixForRow(
              intentRef,
              supAddrLower,
              execUnix
            );

            // Not arrived yet
            if (!etaUnix || nowUnix < etaUnix) continue;

            // ✅ It just arrived (or is overdue). Build receive lines for that supplier.
            const receiveLines: { sku: string; units: number }[] = [];
            for (const it of items) {
              const itSup = String(it?.supplier || "").toLowerCase();
              if (itSup !== supAddrLower) continue;

              const lines = Array.isArray((it as any).lines)
                ? (it as any).lines
                : [];

              for (const ln of lines) {
                const sku = String(ln?.sku || ln?.skuId || "").trim();
                const qty = Math.max(
                  0,
                  Math.floor(
                    Number(ln?.qty ?? ln?.units ?? ln?.quantity ?? 0) || 0
                  )
                );
                if (sku && qty > 0) receiveLines.push({ sku, units: qty });
              }
            }

            // combine duplicates
            const bySku = new Map<string, number>();
            for (const l of receiveLines) {
              bySku.set(l.sku, (bySku.get(l.sku) ?? 0) + l.units);
            }
            const combined = Array.from(bySku.entries()).map(
              ([sku, units]) => ({
                sku,
                units,
              })
            );

            // Mark first (prevents double-apply if interval ticks fast)
            markDemoReceived(env, owner, locationId, intentRef, supAddrLower);

            // Call server to update inventory
            void receiveInventory(combined);
          }
        }
      } catch (e) {
        console.warn("arrival watcher error", e);
      }
    }, 1000);

    return () => window.clearInterval(t);
    // IMPORTANT deps: anything used inside must be included
  }, [locationId, intents, plannedOrders, demoOrderTimes, demoNowMsAbs]);

  useEffect(() => {
    const owner = getSavedOwnerAddress();
    const env = getSavedEnv();
    if (!locationId || !owner || !isAddress(owner)) {
      setDemoOrderTimes({});
      return;
    }

    setDemoOrderTimes(loadDemoOrderTimes(env, owner, locationId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId]);

  useEffect(() => {
    const owner = getSavedOwnerAddress();
    const env = getSavedEnv();
    if (!locationId || !owner || !isAddress(owner)) {
      setPipelineDecBySku({});
      return;
    }

    try {
      const raw = window.localStorage.getItem(
        demoPipelineDecKey(env, owner, locationId)
      );
      const parsed = raw ? JSON.parse(raw) : {};
      setPipelineDecBySku(parsed && typeof parsed === "object" ? parsed : {});
    } catch {
      setPipelineDecBySku({});
    }
  }, [locationId]);

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
    const owner = getSavedOwnerAddress();
    const env = getSavedEnv();
    if (!locationId || !owner || !isAddress(owner)) return;

    fetch(
      `/api/state?locationId=${encodeURIComponent(locationId)}` +
        `&owner=${encodeURIComponent(owner)}` +
        `&env=${encodeURIComponent(env)}`
    )
      .then((r) => r.json())
      .then((json) => {
        const suppliers = Array.isArray(json?.suppliers) ? json.suppliers : [];
        const map: Record<
          string,
          { name: string; address: string; leadTimeDays: number }
        > = {};

        for (const s of suppliers) {
          const name = String(s?.name ?? s?.supplierId ?? "Supplier");
          const addr = String(s?.payoutAddress ?? "");
          if (!addr) continue;

          const leadTimeDaysRaw = Number(s?.leadTimeDays ?? 0);
          const leadTimeDays = Number.isFinite(leadTimeDaysRaw)
            ? Math.max(0, Math.floor(leadTimeDaysRaw))
            : 0;

          map[addr.toLowerCase()] = { name, address: addr, leadTimeDays };
        }

        setSupplierByAddress(map);
        // ✅ Build price + uom maps from state.skus[]
        const skus = Array.isArray(json?.skus) ? json.skus : [];

        const nextPriceBySku: Record<string, number> = {};
        const nextUomBySku: Record<string, string> = {};

        for (const s of skus) {
          const sku = String(s?.sku ?? "");
          if (!sku) continue;

          const unitCost = Number(s?.unitCostUsd ?? 0);
          nextPriceBySku[sku] = Number.isFinite(unitCost) ? unitCost : 0;

          const uom = String(s?.unit ?? "");
          if (uom) nextUomBySku[sku] = uom;
        }

        setPriceBySku(nextPriceBySku);
        setUomBySku(nextUomBySku);
      })
      .catch(() => {
        // ignore
      });
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
  }, []);

  useEffect(() => {
    setHorizonDaysDraft(String(horizonDays));
  }, [horizonDays]);

  useEffect(() => {
    if (!locationId) return;

    refreshOrders();
    refreshState(); // ✅ add this

    const owner = getSavedOwnerAddress();
    if (owner && isAddress(owner)) {
      refreshExecutionMode();
      refreshAutonomyFromChain(owner);
    } else {
      setRequireApproval(null);
      setAgentEnabled(null);
    }
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
              <Link href="/" style={btnSoft(false)}>
                Home
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
              Joe's Diner
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

      <main
        style={{
          width: "100%",
          height: "100%",
          padding: 24,

          display: "grid",
          gridTemplateColumns: chatOpen ? "1fr 1fr" : "1fr",
          gap: 16,
          alignItems: "start",

          // ⬇️ This is the key part
          maxWidth: chatOpen ? "100vw" : 900,
          marginLeft: chatOpen ? 0 : "auto",
          marginRight: chatOpen ? 0 : "auto",
        }}
      >
        <div style={{ minWidth: 0 }}>
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
              <Link href="/" style={btnSoft(false)}>
                Home
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
                Joe's Diner
              </div>
            </div>

            <div
              style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}
            >
              <Link
                href={`/locations/${locationId}/inventory`}
                style={btnSoft(false)}
              >
                Inventory
              </Link>

              <Link
                href={`/locations/${locationId}/suppliers`}
                style={btnSoft(false)}
              >
                Suppliers
              </Link>
            </div>
          </header>
          {/* Demo controls */}
          <section style={{ ...cardStyle, gap: 10, padding: 14 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "nowrap",
                minWidth: 0,
              }}
            >
              {/* Left: title + ? */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  minWidth: 0,
                  flex: "1 1 auto",
                }}
              >
                <div
                  style={{
                    fontWeight: 950,
                    fontSize: 16,
                    whiteSpace: "nowrap",
                  }}
                >
                  Simulate Time
                </div>

                <HelpDot title="Explain Simulate Time" align="left">
                  <div style={{ fontWeight: 950, marginBottom: 8 }}>
                    Simulate Time
                  </div>
                  <div style={{ display: "grid", gap: 8, fontSize: 13 }}>
                    <div style={{ fontWeight: 800 }}>
                      UI-only: fast-forwards countdowns and arrival labels
                      without changing on-chain state.
                    </div>
                  </div>
                </HelpDot>
              </div>

              {/* Right: date pill + button */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  flex: "0 0 auto",
                }}
              >
                <div style={valuePill()}>
                  {new Date(demoNowMs()).toLocaleDateString(undefined, {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}
                </div>

                <button
                  type="button"
                  onClick={async () => {
                    if (advanceDayInFlightRef.current) return;

                    advanceDayInFlightRef.current = true;
                    setAdvanceDayBusy(true);

                    try {
                      const DAY = 24 * 60 * 60 * 1000;

                      const base = demoNowMsAbs ?? appNowMs();
                      const next = base + DAY;
                      const nextUnix = Math.floor(next / 1000);

                      // 1) update simulated clock (state + persist)
                      setDemoNowMsAbs(next);
                      try {
                        window.localStorage.setItem(
                          demoTimeKey(locationId),
                          String(next)
                        );
                      } catch {}

                      // 2) update pipeline decrement map for anything that just arrived at "next"
                      const arrivedBySku = newlyArrivedUnitsBySku(nextUnix);
                      if (Object.keys(arrivedBySku).length > 0) {
                        setPipelineDecBySku((prev) => {
                          const nextMap: PipelineDecMap = { ...(prev || {}) };
                          for (const [sku, units] of Object.entries(
                            arrivedBySku
                          )) {
                            nextMap[sku] =
                              (nextMap[sku] ?? 0) + (Number(units) || 0);
                          }
                          persistPipelineDec(nextMap);
                          return nextMap;
                        });
                      }

                      // 3) apply arrivals to server inventory
                      await applyArrivalsNowUnix(nextUnix);

                      // 4) consume inventory for the simulated day on server
                      await consumeInventoryForSimulatedDays(1, next);

                      // ✅ 5) force UI to re-sync from server after mutations
                      await refreshState(); // ✅ this is what updates pipeline from server
                      await refreshOrders(); // keep this too

                      // If you also render inventory/plan from /api/state elsewhere on this page,
                      // you should call your “refresh state” function here too.
                      // Example (if you have one): await refreshState();
                    } finally {
                      setAdvanceDayBusy(false);
                      advanceDayInFlightRef.current = false;
                    }
                  }}
                  style={btnSoft(false)}
                  title="Fast-forward the UI by 1 day"
                >
                  +1 day
                </button>
              </div>
            </div>
          </section>

          {/* Generate Purchase Plan */}
          <section style={{ ...cardStyle, gap: 10, padding: 14 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                marginBottom: 8,
              }}
            >
              {/* Left */}
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ fontWeight: 950, fontSize: 16 }}>
                  Purchase Plan
                </div>
                <HelpDot title="Explain Purchase Plan">
                  <div style={{ fontWeight: 950, marginBottom: 8 }}>
                    Purchase Plan
                  </div>
                  <div style={{ display: "grid", gap: 8, fontSize: 13 }}>
                    <div style={{ fontWeight: 800 }}>
                      Set how Mozi generates orders from your inventory and
                      supplier data.
                    </div>
                    <div style={{ color: COLORS.subtext, fontWeight: 800 }}>
                      <span style={{ fontWeight: 950, color: COLORS.text }}>
                        Strategy
                      </span>{" "}
                      controls whether Mozi prioritizes minimizing waste,
                      balancing, or avoiding stockouts.
                    </div>
                    <div style={{ color: COLORS.subtext, fontWeight: 800 }}>
                      <span style={{ fontWeight: 950, color: COLORS.text }}>
                        Planning Horizon
                      </span>{" "}
                      is how many days ahead Mozi plans demand (5–30 days).
                    </div>
                    <div style={{ color: COLORS.subtext, fontWeight: 800 }}>
                      <span style={{ fontWeight: 950, color: COLORS.text }}>
                        Additional Context
                      </span>{" "}
                      are temporary notes (like events or promotions) that
                      influence ordering.
                    </div>
                  </div>
                </HelpDot>
              </div>

              {/* Right */}
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                {!editingPlan ? (
                  <button
                    type="button"
                    onClick={() => {
                      setStrategyDraft(strategy);
                      setHorizonDaysDraft(String(horizonDays));
                      setEditingPlan(true);
                    }}
                    style={btnSoft(false)}
                    title="Edit plan settings"
                  >
                    Edit
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        const normalized = draftToClampedInt(
                          horizonDaysDraft,
                          5,
                          30
                        );

                        setStrategy(strategyDraft);
                        setHorizonDays(normalized);
                        setHorizonDaysDraft(String(normalized));

                        if (typeof window !== "undefined") {
                          window.localStorage.setItem(
                            "mozi_plan_strategy",
                            strategyDraft
                          );
                          window.localStorage.setItem(
                            "mozi_plan_horizon_days",
                            String(normalized)
                          );
                        }

                        setEditingPlan(false);
                      }}
                      style={btnSoft(false)}
                      title="Save plan settings"
                    >
                      Done
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setStrategyDraft(strategy);
                        setHorizonDaysDraft(String(horizonDays));
                        setEditingPlan(false);
                      }}
                      style={btnSoft(false)}
                      title="Cancel edits"
                    >
                      Cancel
                    </button>
                  </>
                )}
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
              }}
            >
              <div style={{ display: "grid", gap: 10, gridColumn: "1 / -1" }}>
                {/* Strategy (row 1) + Planning Horizon (row 2) */}
                <div
                  style={{
                    display: "grid",
                    gap: 10,
                    gridColumn: "1 / -1",
                    minWidth: 0,
                  }}
                >
                  {/* Left group: Strategy */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      flexWrap: "wrap",
                      minWidth: 0,
                      flex: "1 1 260px", // allows wrap instead of overflow
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 900,
                        color: COLORS.subtext,
                        whiteSpace: "nowrap",
                      }}
                    >
                      Strategy
                    </div>

                    {!editingPlan ? (
                      <div style={valuePill()}>{strategyLabel(strategy)}</div>
                    ) : (
                      <select
                        value={strategyDraft}
                        onChange={(e) =>
                          setStrategyDraft(
                            e.target
                              .value as PlanInput["ownerPrefs"]["strategy"]
                          )
                        }
                        style={{
                          padding: "10px 12px",
                          borderRadius: 12,
                          border: `1px solid ${COLORS.border}`,
                          background: "rgba(255,255,255,0.85)",
                          color: COLORS.text,
                          fontWeight: 850,
                          outline: "none",
                          minWidth: 220,
                        }}
                      >
                        <option value="balanced">
                          {strategyLabel("balanced")}
                        </option>
                        <option value="min_waste">
                          {strategyLabel("min_waste")}
                        </option>
                        <option value="min_stockouts">
                          {strategyLabel("min_stockouts")}
                        </option>
                      </select>
                    )}
                  </div>

                  {/* Right group: Planning Horizon */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      flexWrap: "wrap",
                      minWidth: 0,
                      flex: "0 0 auto", // ✅ don’t expand / push away
                      justifyContent: "flex-start", // ✅ don’t right-align internally
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 900,
                        color: COLORS.subtext,
                        whiteSpace: "nowrap",
                      }}
                    >
                      Planning Horizon
                    </div>

                    {!editingPlan ? (
                      <div style={valuePill()}>{horizonDays} days</div>
                    ) : (
                      <input
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={horizonDaysDraft}
                        onChange={(e) =>
                          setHorizonDaysDraft(sanitizeIntDraft(e.target.value))
                        }
                        onBlur={() => {
                          const normalized = draftToClampedInt(
                            horizonDaysDraft,
                            5,
                            30
                          );
                          setHorizonDaysDraft(String(normalized));
                        }}
                        onFocus={(e) => e.currentTarget.select()}
                        style={{
                          width: 120,
                          padding: "10px 12px",
                          borderRadius: 12,
                          border: `1px solid ${COLORS.border}`,
                          background: "rgba(255,255,255,0.85)",
                          color: COLORS.text,
                          fontWeight: 850,
                          outline: "none",
                          textAlign: "right",
                        }}
                      />
                    )}
                  </div>
                </div>

                {/* Title row */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                  }}
                >
                  <label style={{ fontWeight: 900, color: COLORS.subtext }}>
                    Additional Context
                  </label>

                  <button
                    type="button"
                    onClick={() => {
                      // toggle editor open/closed
                      setShowContextEditor((v) => !v);
                    }}
                    style={btnSoft(false)}
                    title={
                      showContextEditor
                        ? "Hide inputs"
                        : "Add a new context item"
                    }
                  >
                    {showContextEditor ? "Close" : "Add"}
                  </button>
                </div>
                {showContextEditor ? (
                  <>
                    {/* Input row: aligned fields, checkbox on its own row */}
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 220px auto",
                        gridTemplateRows: "auto auto auto", // labels / inputs / checkbox
                        columnGap: 10,
                        rowGap: 4,
                        alignItems: "start",
                      }}
                    >
                      {/* ---------- Row 1: Labels ---------- */}
                      <div
                        style={{
                          fontWeight: 900,
                          color: COLORS.subtext,
                          fontSize: 12,
                        }}
                      >
                        Context
                      </div>
                      <div
                        style={{
                          fontWeight: 900,
                          color: COLORS.subtext,
                          fontSize: 12,
                        }}
                      >
                        Applies for (days)
                      </div>
                      <div /> {/* spacer for Add column */}
                      {/* ---------- Row 2: Inputs ---------- */}
                      <textarea
                        value={contextDraft}
                        onChange={(e) => setContextDraft(e.target.value)}
                        placeholder='e.g. "Big game Sunday → expect +20% wings"'
                        rows={1}
                        style={{
                          padding: "12px 12px",
                          borderRadius: 12,
                          border: `1px solid ${COLORS.border}`,
                          background: "rgba(255,255,255,0.85)",
                          color: COLORS.text,
                          fontWeight: 800,
                          outline: "none",
                          width: "100%",
                          resize: "vertical",
                          lineHeight: 1.35,
                          whiteSpace: "pre-wrap",
                          boxSizing: "border-box",
                          minHeight: 44,
                        }}
                      />
                      <input
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={contextIndefDraft ? "∞" : contextDaysDraft}
                        readOnly={contextIndefDraft}
                        onChange={(e) => {
                          if (contextIndefDraft) return;
                          setContextDaysDraft(sanitizeIntDraft(e.target.value));
                        }}
                        onBlur={() => {
                          if (contextIndefDraft) return;
                          const normalized = draftToClampedInt(
                            contextDaysDraft,
                            1,
                            365
                          );
                          setContextDaysDraft(String(normalized));
                        }}
                        onFocus={(e) => {
                          if (contextIndefDraft) return;
                          e.currentTarget.select();
                        }}
                        placeholder="Days"
                        style={{
                          padding: "10px 12px",
                          borderRadius: 12,
                          border: `1px solid ${COLORS.border}`,
                          background: contextIndefDraft
                            ? "rgba(15,23,42,0.04)"
                            : "rgba(255,255,255,0.85)",
                          color: COLORS.text,
                          fontWeight: 900,
                          outline: "none",
                          textAlign: "right",
                          cursor: contextIndefDraft ? "default" : "text",
                          boxSizing: "border-box",
                          height: 44,
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const owner = getSavedOwnerAddress();
                          const env = getSavedEnv();
                          if (!owner || !locationId) return;

                          const text = contextDraft.trim();
                          if (!text) return;

                          const days = contextIndefDraft
                            ? 0
                            : draftToClampedInt(contextDaysDraft, 1, 365);

                          const nowMs = appNowMs();

                          const nextItem: AdditionalContextItem = {
                            id: `${nowMs}_${Math.random()
                              .toString(16)
                              .slice(2)}`,
                            text,
                            durationDays: days,
                            createdAtMs: nowMs,
                          };

                          setAdditionalContext((prev) => {
                            const next = [nextItem, ...prev];
                            saveAdditionalContext(env, owner, locationId, next);
                            return next;
                          });

                          setContextDraft("");

                          // optional resets
                          // setContextIndefDraft(false);
                          // setContextDaysDraft("7");

                          // ✅ hide inputs after saving
                          setShowContextEditor(false);
                        }}
                        disabled={!contextDraft.trim()}
                        style={{
                          ...btnSoft(!contextDraft.trim()),
                          height: 44,
                          alignSelf: "start",
                        }}
                        title="Save this context item"
                      >
                        Save
                      </button>
                      {/* ---------- Row 3: Checkbox (only under days column) ---------- */}
                      <div /> {/* empty under Context */}
                      <label
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          fontWeight: 800,
                          fontSize: 12,
                          color: COLORS.subtext,
                          cursor: "pointer",
                          userSelect: "none",
                        }}
                        title="If enabled, this context will never expire"
                      >
                        <input
                          type="checkbox"
                          checked={contextIndefDraft}
                          onChange={(e) =>
                            setContextIndefDraft(e.target.checked)
                          }
                          style={{ width: 14, height: 14 }}
                        />
                        Make Indefinite
                      </label>
                      <div /> {/* empty under Add button */}
                    </div>
                  </>
                ) : null}

                {/* Saved items list (collapsible) */}
                {additionalContext.length === 0 ? (
                  <div style={{ color: COLORS.subtext, fontWeight: 800 }}>
                    No additional context saved.
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 8 }}>
                    {/* Dropdown header */}
                    <button
                      type="button"
                      onClick={() => setContextListOpen((v) => !v)}
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 10,
                        padding: "10px 12px",
                        borderRadius: 12,
                        border: `1px solid ${COLORS.border}`,
                        background: "rgba(255,255,255,0.75)",
                        cursor: "pointer",
                      }}
                      aria-expanded={contextListOpen}
                      title={
                        contextListOpen
                          ? "Hide saved context"
                          : "Show saved context"
                      }
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                        }}
                      >
                        <div style={{ fontWeight: 950, color: COLORS.text }}>
                          Saved Context
                        </div>

                        <span
                          style={{
                            ...pillStyle({
                              bg: "rgba(15,23,42,0.06)",
                              border: COLORS.border,
                              text: COLORS.subtext,
                            }),
                            fontWeight: 950,
                          }}
                        >
                          {additionalContext.length}
                        </span>
                      </div>

                      <ChevronDown open={contextListOpen} />
                    </button>

                    {/* Collapsible body */}
                    {contextListOpen ? (
                      <div style={{ display: "grid", gap: 8 }}>
                        {additionalContext.map((it) => {
                          const active = isContextActive(it);
                          const indefinite = Number(it.durationDays ?? 0) === 0;
                          const expiresAtMs = indefinite
                            ? null
                            : it.createdAtMs +
                              it.durationDays * 24 * 60 * 60 * 1000;

                          return (
                            <div
                              key={it.id}
                              style={{
                                border: `1px solid ${COLORS.border}`,
                                background: "rgba(255,255,255,0.75)",
                                borderRadius: 12,
                                padding: 12,
                                display: "grid",
                                gap: 6,
                                opacity: active ? 1 : 0.55,
                              }}
                            >
                              <div
                                style={{
                                  display: "grid",
                                  gridTemplateColumns: "1fr auto",
                                  gap: 10,
                                  alignItems: "start",
                                }}
                              >
                                <div
                                  style={{
                                    fontWeight: 900,
                                    color: COLORS.text,
                                  }}
                                >
                                  {it.text}
                                </div>

                                <button
                                  type="button"
                                  onClick={() => {
                                    const owner = getSavedOwnerAddress();
                                    const env = getSavedEnv();
                                    if (!owner || !locationId) return;

                                    setAdditionalContext((prev) => {
                                      const next = prev.filter(
                                        (x) => x.id !== it.id
                                      );
                                      saveAdditionalContext(
                                        env,
                                        owner,
                                        locationId,
                                        next
                                      );
                                      return next;
                                    });
                                  }}
                                  style={{
                                    padding: "8px 10px",
                                    borderRadius: 10,
                                    border: `1px solid ${COLORS.dangerBorder}`,
                                    background: COLORS.dangerBg,
                                    color: COLORS.dangerText,
                                    fontWeight: 950,
                                    cursor: "pointer",
                                  }}
                                  title="Remove this context item"
                                >
                                  Remove
                                </button>
                              </div>

                              <div
                                style={{
                                  display: "flex",
                                  gap: 12,
                                  flexWrap: "wrap",
                                  color: COLORS.subtext,
                                  fontWeight: 800,
                                  fontSize: 12,
                                }}
                              >
                                <div>
                                  Applies for:{" "}
                                  {indefinite
                                    ? "Indefinite"
                                    : `${it.durationDays} days`}
                                </div>

                                <div>
                                  Expires:{" "}
                                  {indefinite
                                    ? "Never"
                                    : new Date(
                                        expiresAtMs as number
                                      ).toLocaleString()}
                                </div>

                                <div style={{ fontWeight: 950 }}>
                                  {active ? "Active" : "Expired"}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
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
              </div>

              {/* Right: buttons */}
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                {/* Generate/Plan orders */}
                <button
                  type="button"
                  onClick={generateOrders}
                  disabled={loading || ordersLoading || cancelAnyUi}
                  style={btnPrimary(loading || ordersLoading || cancelAnyUi)}
                  title="Create new on-chain orders"
                >
                  {loading ? "Generating…" : "Generate Orders"}
                </button>
              </div>
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
                {(() => {
                  // 1) Convert plannedOrders -> “intent-like” rows
                  type DisplayIntent =
                    | (IntentRow & { __kind: "chain" })
                    | (IntentRow & {
                        __kind: "planned";
                        __plannedId: string;
                        __createdAtMs: number;
                      });

                  const plannedAsIntents: DisplayIntent[] = plannedOrders.map(
                    (p) => ({
                      ...(p.intent as any),
                      ref: `planned:${p.id}`, // IMPORTANT: unique key
                      __kind: "planned",
                      __plannedId: p.id,
                      __createdAtMs: p.createdAtMs,
                    })
                  );

                  const chainAsIntents: DisplayIntent[] = (
                    intents as any[]
                  ).map((it) => ({
                    ...(it as any),
                    __kind: "chain",
                  }));

                  // 2) Merge them
                  const merged: DisplayIntent[] = [
                    ...plannedAsIntents,
                    ...chainAsIntents,
                  ];

                  // 3) Sort newest first:
                  // - planned: by createdAtMs
                  // - chain: by executeAfter
                  const sorted = merged.sort((a, b) => {
                    const aKey =
                      a.__kind === "planned"
                        ? Number((a as any).__createdAtMs || 0)
                        : Number(a.executeAfter || 0) * 1000;

                    const bKey =
                      b.__kind === "planned"
                        ? Number((b as any).__createdAtMs || 0)
                        : Number(b.executeAfter || 0) * 1000;

                    return bKey - aKey;
                  });

                  // Show last 10 total (planned + chain)
                  const visibleIntents = sorted.slice(0, 50);

                  return visibleIntents.map((intent, orderIdx) => {
                    const isPlanned = (intent as any).__kind === "planned";
                    const plannedId = isPlanned
                      ? String((intent as any).__plannedId || "")
                      : "";
                    // FIXED execution time per order:
                    // - planned orders: use the stored createdAtMs (already based on appNowMs when created)
                    // - chain orders: MUST come from backend (createdAtUnix) or we fall back to executeAfter
                    const snapshotKey = isPlanned
                      ? `planned:${plannedId}`
                      : String(intent.ref || "");
                    const snap = snapshotKey
                      ? demoOrderTimes[snapshotKey]
                      : undefined;

                    const execUnix =
                      snap?.execUnix ??
                      (isPlanned
                        ? Math.floor(
                            Number((intent as any).__createdAtMs || 0) / 1000
                          )
                        : Number(
                            (intent as any).createdAtUnix ??
                              (intent as any)?.items?.[0]?.createdAtUnix ??
                              intent.executeAfter ??
                              0
                          ));

                    const key = isPlanned
                      ? `planned:${plannedId}`
                      : String(intent.ref || "") ||
                        `chain:${String(intent.owner || "")}`;
                    const isOpen = Boolean(openOrderKeys[key]);
                    const isEditingThisPlanned =
                      isPlanned && editingPlannedId === plannedId;

                    const toggleOpen = () =>
                      setOpenOrderKeys((prev) => ({
                        ...prev,
                        [key]: !prev[key],
                      }));

                    const items = Array.isArray(intent.items)
                      ? intent.items
                      : [];

                    // ✅ Flatten to one row per SKU (instead of one row per supplier-order item)
                    const skuRows = items.flatMap((it) => {
                      const sup = supplierLabel(String(it.supplier || ""));
                      const execAt = Number(
                        it.executeAfter ?? intent.executeAfter ?? 0
                      );
                      const lines = Array.isArray((it as any).lines)
                        ? (it as any).lines
                        : [];

                      return lines.map((ln: any, idx: number) => {
                        const qty =
                          Number(ln?.qty ?? ln?.units ?? ln?.quantity ?? 0) ||
                          0;

                        const sku = String(ln?.sku || ln?.skuId || "");
                        const unitPrice = priceBySku[sku] ?? 0;
                        const lineTotal = qty * unitPrice;

                        const orderId = String(
                          (it as any).orderId || (it as any).id || ""
                        );
                        const rowKey = `${orderId}:${sku}:${idx}`;

                        return {
                          __rowKey: rowKey, // ✅ add
                          supplierName: sup.name,
                          supplierAddr: sup.address,
                          executeAfter: execAt,
                          orderId,
                          sku,
                          name: ln?.name ? String(ln.name) : "",
                          qty,
                          uom: ln?.uom ? String(ln.uom) : uomBySku[sku] ?? "",
                          unitPrice,
                          lineTotal,
                        };
                      });
                    });

                    // -------------------------
                    // ✅ Real computed totals (qty × unitPrice)
                    // -------------------------
                    const computedTotalUsd = skuRows.reduce((acc, r) => {
                      const qty = Number(r.qty) || 0;
                      const unitPrice = Number(r.unitPrice) || 0;
                      if (!Number.isFinite(qty) || !Number.isFinite(unitPrice))
                        return acc;
                      return acc + qty * unitPrice;
                    }, 0);

                    // Helpful flags for fallback logic
                    const hasAnyPricedLine = skuRows.some(
                      (r) => Number.isFinite(r.unitPrice) && r.unitPrice > 0
                    );

                    // Totals + supplier summary
                    const totalRaw = items.reduce((acc, it) => {
                      try {
                        return acc + BigInt(String(it.amount ?? "0"));
                      } catch {
                        return acc;
                      }
                    }, BigInt(0));

                    // ✅ Prefer computed price totals. Fallback to raw on-chain total if we have no priced lines.
                    let costStr = "—";

                    if (hasAnyPricedLine) {
                      costStr = `$${computedTotalUsd.toFixed(2)}`;
                    } else {
                      // fallback (old behavior)
                      try {
                        const usd = Number(formatUnits(totalRaw, 18));
                        costStr = `$${usd.toFixed(2)}`;
                      } catch {
                        costStr = "—";
                      }
                    }

                    const supplierAddrs = Array.from(
                      new Set(
                        items.map((it) =>
                          String(it.supplier || "").toLowerCase()
                        )
                      )
                    ).filter(Boolean);

                    const supplierNames = supplierAddrs
                      .map((addr) => supplierLabel(addr).name)
                      .slice(0, 3);

                    const supplierSummary =
                      supplierAddrs.length <= 3
                        ? supplierNames.join(", ")
                        : `${supplierNames.join(", ")} +${
                            supplierAddrs.length - 3
                          } more`;

                    const statusLabel = intent.canceled
                      ? "Canceled"
                      : intent.executed
                      ? "Executed"
                      : "Pending";

                    const statusPill = intent.canceled
                      ? pillStyle({
                          bg: COLORS.dangerBg,
                          border: COLORS.dangerBorder,
                          text: COLORS.dangerText,
                        })
                      : intent.executed
                      ? pillStyle({
                          bg: COLORS.greenBg,
                          border: COLORS.greenBorder,
                          text: COLORS.greenText,
                        })
                      : pillStyle({
                          bg: COLORS.warnBg,
                          border: COLORS.warnBorder,
                          text: COLORS.warnText,
                        });

                    const nowUnix = demoNowUnix();
                    const pendingEnded =
                      Number(intent.executeAfter ?? 0) > 0 &&
                      nowUnix >= Number(intent.executeAfter);

                    const canApprove =
                      Boolean(requireApproval) &&
                      !intent.canceled &&
                      !intent.executed &&
                      !intent.approved &&
                      !pendingEnded;

                    return (
                      <div
                        key={key}
                        style={{
                          border: `1px solid ${COLORS.border}`,
                          borderRadius: 14,
                          padding: 14,
                          background: "rgba(255,255,255,0.75)",
                          display: "grid",
                          gap: 10,
                          opacity: intent.canceled ? 0.55 : 1,
                        }}
                      >
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "1fr auto",
                            gap: 10,
                            alignItems: "start",
                          }}
                        >
                          <div style={{ display: "grid", gap: 4 }}>
                            {/* Row 1: Order */}
                            <div style={{ fontWeight: 950 }}>
                              Order {visibleIntents.length - orderIdx}
                            </div>

                            {/* Row 2: Suppliers summary */}
                            <div
                              style={{
                                color: COLORS.subtext,
                                fontWeight: 800,
                                fontSize: 13,
                              }}
                            >
                              Suppliers: {supplierSummary || "—"}
                            </div>
                          </div>

                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "flex-end",
                              gap: 10,
                              flexWrap: "wrap",
                            }}
                          >
                            {intent.canceled || intent.executed ? (
                              <span style={statusPill}>{statusLabel}</span>
                            ) : null}

                            <div style={{ textAlign: "right" }}>
                              <div
                                style={{
                                  color: COLORS.subtext,
                                  fontWeight: 900,
                                  fontSize: 12,
                                }}
                              >
                                Cost
                              </div>
                              <div style={{ fontWeight: 950, fontSize: 18 }}>
                                {costStr}
                              </div>
                            </div>

                            {canApprove ? (
                              <button
                                type="button"
                                onClick={() => approveIntent(intent.ref)}
                                disabled={
                                  approvingRef === intent.ref || cancelAnyUi
                                }
                                style={btnSoft(
                                  approvingRef === intent.ref || cancelAnyUi
                                )}
                                title="Approve this intent (required for Manual mode)"
                              >
                                {approvingRef === intent.ref
                                  ? "Approving…"
                                  : "Approve"}
                              </button>
                            ) : null}

                            <button
                              type="button"
                              aria-label={
                                isOpen
                                  ? "Collapse intent details"
                                  : "Expand intent details"
                              }
                              onClick={toggleOpen}
                              title={isOpen ? "Hide details" : "Show details"}
                              style={{
                                width: 34,
                                height: 34,
                                borderRadius: 10,
                                border: `1px solid ${COLORS.border}`,
                                background: "rgba(255,255,255,0.75)",
                                color: COLORS.subtext,
                                fontWeight: 950,
                                cursor: "pointer",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                padding: 0,
                                userSelect: "none",
                              }}
                            >
                              <ChevronDown open={isOpen} />
                            </button>
                          </div>

                          {isOpen ? (
                            <div
                              style={{
                                gridColumn: "1 / -1",
                                borderTop: `1px solid ${COLORS.border}`,
                                paddingTop: 10,
                                display: "grid",
                                gap: 10,
                              }}
                            >
                              <div
                                style={{
                                  display: "grid",
                                  gridTemplateColumns: "1fr",
                                  gap: 10,
                                  fontSize: 13,
                                  color: COLORS.subtext,
                                  fontWeight: 850,
                                }}
                              >
                                <div>
                                  <div
                                    style={{
                                      fontWeight: 950,
                                      color: COLORS.text,
                                    }}
                                  >
                                    Execution time
                                  </div>
                                  <div>{fmtWhenFixedUnix(execUnix)}</div>
                                </div>
                              </div>

                              <div
                                style={{
                                  width: "100%",
                                  overflowX: "auto",
                                  border: `1px solid ${COLORS.border}`,
                                  borderRadius: 12,
                                  background: "rgba(255,255,255,0.65)",
                                }}
                              >
                                <table
                                  style={{
                                    width: "100%",
                                    borderCollapse: "collapse",
                                  }}
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
                                        Quantity
                                      </th>

                                      {/* ✅ Supplier becomes 3rd column */}
                                      <th
                                        style={{
                                          textAlign: "left",
                                          padding: 12,
                                          fontWeight: 950,
                                        }}
                                      >
                                        Supplier
                                      </th>

                                      {/* ✅ Price becomes 4th column */}
                                      <th
                                        style={{
                                          textAlign: "right",
                                          padding: 12,
                                          fontWeight: 950,
                                        }}
                                      >
                                        Price
                                      </th>

                                      <th
                                        style={{
                                          textAlign: "left",
                                          padding: 12,
                                          fontWeight: 950,
                                        }}
                                      >
                                        Arrival Time
                                      </th>
                                    </tr>
                                  </thead>

                                  <tbody>
                                    {skuRows.map((r, idx) => (
                                      <tr key={`${r.orderId}:${r.sku}:${idx}`}>
                                        {/* SKU */}
                                        <td
                                          style={{
                                            padding: 12,
                                            borderTop: "1px solid #eef2f7",
                                            fontFamily:
                                              "ui-monospace, Menlo, monospace",
                                            fontWeight: 900,
                                            color: COLORS.text,
                                            whiteSpace: "nowrap",
                                          }}
                                        >
                                          {r.sku || "—"}
                                        </td>

                                        {/* Quantity */}
                                        <td
                                          style={{
                                            padding: 12,
                                            borderTop: "1px solid #eef2f7",
                                            textAlign: "right",
                                            fontWeight: 950,
                                            color: COLORS.text,
                                            whiteSpace: "nowrap",
                                          }}
                                        >
                                          {Number.isFinite(r.qty) ? r.qty : "—"}
                                        </td>

                                        {/* Supplier (✅ now 3rd column) */}
                                        <td
                                          style={{
                                            padding: 12,
                                            borderTop: "1px solid #eef2f7",
                                            fontWeight: 850,
                                            color: COLORS.text,
                                          }}
                                        >
                                          <div style={{ fontWeight: 950 }}>
                                            {r.supplierName}
                                          </div>
                                        </td>

                                        {/* Price (✅ now 4th column) */}
                                        <td
                                          style={{
                                            padding: 12,
                                            borderTop: "1px solid #eef2f7",
                                            textAlign: "right",
                                            fontWeight: 950,
                                            color: COLORS.text,
                                            whiteSpace: "nowrap",
                                          }}
                                        >
                                          {Number.isFinite(r.lineTotal) &&
                                          r.lineTotal > 0
                                            ? `$${r.lineTotal.toFixed(2)}`
                                            : "—"}
                                        </td>

                                        {/* Arrival Time (frozen ETA, countdown driven by demo clock) */}
                                        <td
                                          style={{
                                            padding: 12,
                                            borderTop: "1px solid #eef2f7",
                                            fontWeight: 850,
                                            color: COLORS.subtext,
                                            whiteSpace: "nowrap",
                                          }}
                                        >
                                          {(() => {
                                            // snapshotKey is already defined earlier in your intent map loop
                                            const etaUnix =
                                              getFixedEtaUnixForRow(
                                                snapshotKey,
                                                r.supplierAddr,
                                                execUnix
                                              );

                                            // demoNowUnix() uses your simulated time
                                            const remaining =
                                              etaUnix - demoNowUnix();

                                            // ✅ After arrival
                                            if (remaining <= 0)
                                              return "Arrived";

                                            // ✅ Countdown again
                                            return formatCountdown(remaining);
                                          })()}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>

                                  <tfoot>
                                    <tr>
                                      {/* Total label spans SKU + Quantity + Supplier */}
                                      <td
                                        style={{
                                          padding: 12,
                                          borderTop: `2px solid ${COLORS.border}`,
                                          fontWeight: 950,
                                          color: COLORS.text,
                                        }}
                                        colSpan={3}
                                      >
                                        Total
                                      </td>

                                      {/* Total amount goes in the Price column */}
                                      <td
                                        style={{
                                          padding: 12,
                                          borderTop: `2px solid ${COLORS.border}`,
                                          textAlign: "right",
                                          fontWeight: 950,
                                          color: COLORS.text,
                                          whiteSpace: "nowrap",
                                        }}
                                      >
                                        {costStr}
                                      </td>

                                      {/* Blank cell for Arrival Time column */}
                                      <td
                                        style={{
                                          padding: 12,
                                          borderTop: `2px solid ${COLORS.border}`,
                                        }}
                                      />
                                    </tr>
                                  </tfoot>
                                </table>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            )}
          </section>
        </div>
        {/* Floating Chat Button + Right Drawer */}
        <>
          {/* Floating button */}
          <button
            type="button"
            onClick={() => setChatOpen(true)}
            style={{
              position: "fixed",
              right: 18,
              bottom: 18,
              zIndex: 1000,
              padding: "12px 14px",
              borderRadius: 999,
              border: `1px solid ${COLORS.border}`,
              background: COLORS.primary,
              color: COLORS.buttonTextLight,
              fontWeight: 950,
              cursor: "pointer",
              boxShadow: "0 10px 24px rgba(0,0,0,0.18)",
            }}
            aria-label="Open Mozi Chat"
            title="Mozi Chat"
          >
            Mozi Chat
          </button>

          {/* Drawer */}
          <div
            role="dialog"
            aria-label="Mozi Chat Drawer"
            style={{
              position: "fixed",
              top: 0,
              right: 0,
              height: "100vh",
              width: "50vw",
              maxWidth: 720,
              minWidth: 360,
              backgroundColor: "#020617", // fallback
              backgroundImage: [
                "radial-gradient(900px 500px at 20% 10%, rgba(37,99,235,0.25) 0%, rgba(37,99,235,0) 60%)",
                "radial-gradient(800px 500px at 80% 30%, rgba(99,102,241,0.22) 0%, rgba(99,102,241,0) 55%)",
                "linear-gradient(180deg, #0f172a 0%, #020617 55%, #020617 100%)",
              ].join(","),
              color: COLORS.text, // <-- IMPORTANT: stops white text leaking into light panels

              borderLeft: `1px solid ${COLORS.border}`,
              boxShadow: "-14px 0 40px rgba(0,0,0,0.14)",
              zIndex: 1000,
              transform: chatOpen ? "translateX(0)" : "translateX(110%)",
              transition: "transform 180ms ease",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {/* Header */}
            <div
              style={{
                padding: 14,
                borderBottom: `1px solid ${COLORS.border}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                background: "#ffffff",
                backdropFilter: "none",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ fontWeight: 950, fontSize: 16 }}>Mozi Chat</div>

                <HelpDot title="Mozi Chat help" align="left">
                  <div style={{ fontWeight: 950, marginBottom: 8 }}>
                    Mozi Chat
                  </div>
                  <div style={{ display: "grid", gap: 8, fontSize: 13 }}>
                    <div style={{ fontWeight: 800 }}>
                      Ask about inventory, suppliers, seasonality, upcoming
                      events, or ordering strategy.
                    </div>
                    <div style={{ color: COLORS.subtext, fontWeight: 750 }}>
                      Saved Notes (Additional Context) are edited in the
                      Purchase Plan section.
                    </div>
                  </div>
                </HelpDot>
              </div>

              {/* Red X in top-right */}
              <button
                type="button"
                onClick={() => setChatOpen(false)}
                style={chatCloseBtn}
                aria-label="Close chat"
                title="Close"
              >
                ✕
              </button>
            </div>

            {/* Body */}
            <div
              style={{
                padding: 14,
                display: "flex",
                flexDirection: "column",
                gap: 12,
                flex: 1,
                minHeight: 0,
              }}
            >
              {/* Conversation */}
              <div
                style={{
                  flex: 1,
                  minHeight: 0,
                  overflow: "auto",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  padding: 12,
                  borderRadius: 14,
                  border: `1px solid ${COLORS.border}`,
                  background: "#ffffff",
                  backdropFilter: "none",
                }}
              >
                {chatMessages.length === 0 ? (
                  <div
                    style={{
                      color: COLORS.subtext,
                      fontWeight: 850,
                      lineHeight: 1.4,
                      background: "rgba(255,255,255,0.85)",
                      border: `1px solid ${COLORS.border}`,
                      borderRadius: 14,
                      padding: 12,
                    }}
                  >
                    Ask about inventory, suppliers, seasonality, upcoming
                    events, or ordering strategy.
                  </div>
                ) : (
                  chatMessages.map((m, idx) => (
                    <div
                      key={idx}
                      style={{
                        display: "flex",
                        justifyContent:
                          m.role === "user" ? "flex-end" : "flex-start",
                      }}
                    >
                      <div style={bubbleStyle(m.role)}>
                        <div
                          style={{
                            color: COLORS.subtext,
                            fontWeight: 950,
                            fontSize: 11,
                            marginBottom: 6,
                          }}
                        >
                          {m.role === "user" ? "You" : "Mozi"}
                        </div>
                        {m.content}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Input */}
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "center",
                  padding: 12,
                  borderRadius: 14,
                  border: `1px solid ${COLORS.border}`,
                  background: "#ffffff",
                  backdropFilter: "none",
                }}
              >
                <input
                  value={chatDraft}
                  onChange={(e) => setChatDraft(e.target.value)}
                  placeholder='e.g. "We have a catering event Friday—what should I watch out for?"'
                  onKeyDown={(e) => {
                    if (e.key === "Enter") sendChat();
                  }}
                  style={{
                    flex: 1,
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: `1px solid ${COLORS.border}`,
                    background: "rgba(255,255,255,0.92)",
                    color: COLORS.text,
                    fontWeight: 800,
                    outline: "none",
                  }}
                />

                <button
                  type="button"
                  onClick={sendChat}
                  disabled={chatLoading || !chatDraft.trim()}
                  style={{
                    ...btnPrimary(chatLoading || !chatDraft.trim()),
                    borderRadius: 12,
                    boxShadow: "0 10px 22px rgba(37,99,235,0.22)",
                  }}
                >
                  {chatLoading ? "Sending…" : "Send"}
                </button>
              </div>

              {chatError ? (
                <div
                  style={{
                    border: `1px solid ${COLORS.warnBorder}`,
                    background: COLORS.warnBg,
                    color: COLORS.warnText,
                    borderRadius: 12,
                    padding: 12,
                    fontWeight: 850,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {chatError}
                </div>
              ) : null}
            </div>
          </div>
        </>
      </main>
    </div>
  );
}
