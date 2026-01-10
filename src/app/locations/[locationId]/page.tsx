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

function draftToClampedInt(draft: string, min: number, max: number) {
  if (!draft) return min; // if user leaves blank, snap to min
  const n = parseInt(draft, 10);
  if (!Number.isFinite(n) || Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
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

function demoTimeKey(locationId: string) {
  return `mozi_demo_time_offset_ms:${locationId}`;
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
  const [demoNowOffsetMs, setDemoNowOffsetMs] = useState(0);

  // --- Demo time travel (UI-only) ---
  const demoTimeHydratedRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!locationId) return;

    try {
      const raw = window.localStorage.getItem(demoTimeKey(locationId));
      if (raw != null) {
        const n = Number(raw);
        if (Number.isFinite(n)) setDemoNowOffsetMs(n);
      }
    } catch {
      // ignore
    } finally {
      demoTimeHydratedRef.current = true;
    }
  }, [locationId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!locationId) return;

    // don't save until we've loaded once
    if (!demoTimeHydratedRef.current) return;

    try {
      window.localStorage.setItem(
        demoTimeKey(locationId),
        String(demoNowOffsetMs)
      );
    } catch {
      // ignore
    }
  }, [demoNowOffsetMs, locationId]);

  function demoNowMs() {
    return Date.now() + demoNowOffsetMs;
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

  async function consumeInventoryForSimulatedDays(daysAdvanced: number) {
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

    // deterministic randomness per simulated day (so it feels stable)
    // seed changes each simulated day but repeats if you reload
    const dayIndex = Math.floor(demoNowMs() / (24 * 60 * 60 * 1000));
    const rng = makeSeededRng(dayIndex ^ 0x9e3779b9);

    // build avg daily consumption from sales window (fallback small baseline)
    const dailyRateBySku = new Map<string, number>();
    for (const row of salesBySku) {
      const sku = String(row?.sku ?? "");
      const unitsSold = Number(row?.unitsSold ?? 0);
      if (!sku) continue;
      const rate = Math.max(0, unitsSold / Math.max(1, windowDays));
      dailyRateBySku.set(sku, rate);
    }

    // Optional: mild “event lift” if any upcoming event matches the simulated date
    // (keeps it simple but believable)
    const today = new Date(demoNowMs());
    const todayIso = today.toISOString().slice(0, 10);
    const upcomingEvents = Array.isArray(state?.context?.upcomingEvents)
      ? state.context.upcomingEvents
      : [];
    const todaysEventLiftPct = upcomingEvents
      .filter((e: any) => String(e?.date ?? "") === todayIso)
      .reduce(
        (acc: number, e: any) =>
          acc + Number(e?.expectedDemandLiftPercent ?? 0),
        0
      );

    const demandLift = 1 + Math.max(0, todaysEventLiftPct) / 100;

    // pick ~10-14 SKUs to consume per day (fast + avoids huge payloads)
    const shuffled = [...inventory].sort(() => rng() - 0.5);
    const pickCount = clampInt(10 + rng() * 5, 8, 16);
    const picked = shuffled.slice(0, pickCount);

    const lines = picked
      .map((invRow: any) => {
        const sku = String(invRow?.sku ?? "");
        const onHand = Number(invRow?.onHandUnits ?? 0);
        if (!sku || !Number.isFinite(onHand) || onHand <= 0) return null;

        const base = dailyRateBySku.get(sku) ?? 0.4; // fallback: slow drip
        // randomness: 0.6–1.6x, plus event lift
        const mult = (0.6 + rng() * 1.0) * demandLift;

        // consume at least 0, typically 0–(base*mult*daysAdvanced*~1.3)
        const rawConsume = base * mult * daysAdvanced;
        const jitter = (rng() - 0.5) * rawConsume * 0.35; // +/- 35% of that
        const consume = clampInt(rawConsume + jitter, 0, Math.max(0, onHand));

        if (consume <= 0) return null;
        return { sku, units: consume };
      })
      .filter(Boolean);

    if (lines.length === 0) return;

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
    return Date.now() < expiresAt;
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

  // Draft inputs
  const [contextDraft, setContextDraft] = useState("");
  const [contextDaysDraft, setContextDaysDraft] = useState("7");
  const [contextIndefDraft, setContextIndefDraft] = useState(false);

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
        const nextItem: AdditionalContextItem = {
          id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
          text: json.memoryAppend.trim(),
          durationDays: 7,
          createdAtMs: Date.now(),
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

  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState<string>("");
  const [intents, setIntents] = useState<IntentRow[]>([]);

  // which order cards are expanded (keyed by grouped order key)
  const [openOrderKeys, setOpenOrderKeys] = useState<Record<string, boolean>>(
    {}
  );

  // Supplier display map: payoutAddress(lower) -> { name, address }
  // Supplier display map: payoutAddress(lower) -> { name, address, leadTimeDays }
  const [supplierByAddress, setSupplierByAddress] = useState<
    Record<string, { name: string; address: string; leadTimeDays: number }>
  >({});

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
  const [nowTick, setNowTick] = useState(0);

  const lastOrdersAutoUpdateAt = useRef(0);

  // auto-update interval (12 hours) - for automatic on-chain order syncs
  const ordersAutoUpdateIntervalMs = 12 * 60 * 60 * 1000; // 12 hours

  useEffect(() => {
    const id = window.setInterval(() => setNowTick((x) => x + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Manual vs Autonomous (from chain)
  const [requireApproval, setRequireApproval] = useState<boolean | null>(null);

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

  async function refreshOrders() {
    if (cancelAnyInFlight.current) return;

    // Prevent overlapping refreshes
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
      refreshOrdersInFlight.current = false;
      return;
    }

    if (!locationId) {
      setIntents([]);
      setRequireApproval(null);
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

      // Optional: you can stop fetching requireApproval entirely (not relevant now)
      setRequireApproval(null);
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

  async function generateOrders() {
    if (!locationId) return;

    // prevent double-clicks
    if (manualGenerateInFlight.current) return;

    setLoading(true);
    manualGenerateInFlight.current = true;

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

      // ✅ This is the flow:
      // UI → /api/orders/propose → server runs AI planning and broadcasts txs immediately
      const res = await fetch(
        `/api/orders/propose?locationId=${encodeURIComponent(locationId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            env,
            ownerAddress: owner,

            // ✅ no pending period / no approval step
            pendingWindowHours: 0,

            // ✅ pass control knobs
            strategy,
            horizonDays,
            notes: formatContextForNotes(additionalContext),
          }),
        }
      );

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setError(
          `GENERATE ORDERS HTTP ${res.status}\n` + JSON.stringify(json, null, 2)
        );
        return;
      }

      // ✅ immediately refresh Orders section so executed order details appear
      await refreshOrders();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      manualGenerateInFlight.current = false;
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
    // one fetch on mount for this location
    refreshOrders();
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
                    const DAY = 24 * 60 * 60 * 1000;
                    const next = demoNowOffsetMs + DAY;

                    // update state
                    setDemoNowOffsetMs(next);

                    // ✅ write immediately so navigation can't skip persistence
                    try {
                      window.localStorage.setItem(
                        demoTimeKey(locationId),
                        String(next)
                      );
                    } catch {}

                    await consumeInventoryForSimulatedDays(1);
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
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <label style={{ fontWeight: 900, color: COLORS.subtext }}>
                    Additional Context
                  </label>

                  <HelpDot title="What is Additional Context?">
                    <div style={{ fontWeight: 950, marginBottom: 8 }}>
                      Additional Context
                    </div>
                    <div style={{ display: "grid", gap: 8, fontSize: 13 }}>
                      <div>
                        Add one-off notes that should affect ordering
                        assumptions.
                      </div>
                      <div style={{ color: COLORS.subtext, fontWeight: 750 }}>
                        Each note has a duration in days. Expired notes won’t be
                        sent when generating orders.
                      </div>
                    </div>
                  </HelpDot>
                </div>

                {/* Input row: context + (days label+input) + indefinite toggle + add */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 220px auto",
                    gap: 10,
                    alignItems: "end", // ✅ makes inputs line up even with labels
                  }}
                >
                  {/* Context text */}
                  <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 900,
                        color: COLORS.subtext,
                        fontSize: 12,
                      }}
                    >
                      Context
                    </div>

                    <textarea
                      value={contextDraft}
                      onChange={(e) => setContextDraft(e.target.value)}
                      placeholder='e.g. "Big game Sunday → expect +20% wings"'
                      rows={1} // 👈 starts taller than 1 line
                      style={{
                        padding: "12px 12px",
                        borderRadius: 12,
                        border: `1px solid ${COLORS.border}`,
                        background: "rgba(255,255,255,0.85)",
                        color: COLORS.text,
                        fontWeight: 800,
                        outline: "none",
                        width: "100%",
                        resize: "vertical", // 👈 user can drag taller if needed
                        lineHeight: 1.35,
                        whiteSpace: "pre-wrap",
                      }}
                    />
                  </div>

                  {/* Applies for (days) + Indefinite checkbox underneath */}
                  <div style={{ display: "grid", gap: 6 }}>
                    <div
                      style={{
                        fontWeight: 900,
                        color: COLORS.subtext,
                        fontSize: 12,
                      }}
                    >
                      Applies for (days)
                    </div>

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
                      }}
                    />

                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontWeight: 800, // slightly lighter
                        fontSize: 12, // 👈 smaller text
                        color: COLORS.subtext, // softer color
                        cursor: "pointer",
                        userSelect: "none",
                        marginTop: 2,
                      }}
                      title="If enabled, this context will never expire"
                    >
                      <input
                        type="checkbox"
                        checked={contextIndefDraft}
                        onChange={(e) => setContextIndefDraft(e.target.checked)}
                        style={{ width: 14, height: 14 }} // slightly smaller checkbox
                      />
                      Make Indefinite
                    </label>
                  </div>

                  {/* Add button */}
                  <button
                    type="button"
                    onClick={() => {
                      const owner = getSavedOwnerAddress();
                      const env = getSavedEnv();
                      if (!owner || !locationId) return;

                      const text = contextDraft.trim();
                      if (!text) return;

                      // ✅ durationDays: 0 means indefinite
                      const days = contextIndefDraft
                        ? 0
                        : draftToClampedInt(contextDaysDraft, 1, 365);

                      const nextItem: AdditionalContextItem = {
                        id: `${Date.now()}_${Math.random()
                          .toString(16)
                          .slice(2)}`,
                        text,
                        durationDays: days,
                        createdAtMs: Date.now(),
                      };

                      setAdditionalContext((prev) => {
                        const next = [nextItem, ...prev];
                        saveAdditionalContext(env, owner, locationId, next);
                        return next;
                      });

                      setContextDraft("");
                      // keep days/toggle as-is for quick entry
                    }}
                    disabled={!contextDraft.trim()}
                    style={btnSoft(!contextDraft.trim())}
                    title="Save this context item"
                  >
                    Add
                  </button>
                </div>

                {/* Saved items list */}
                {additionalContext.length === 0 ? (
                  <div style={{ color: COLORS.subtext, fontWeight: 800 }}>
                    No additional context saved.
                  </div>
                ) : (
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
                              style={{ fontWeight: 900, color: COLORS.text }}
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

              {/* Right: buttons */}
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <button
                  type="button"
                  onClick={generateOrders}
                  disabled={loading || ordersLoading || cancelAnyUi}
                  style={btnPrimary(loading || ordersLoading || cancelAnyUi)}
                  title="Create new on-chain orders"
                >
                  {loading ? "Generating…" : "Generate Orders"}
                </button>

                <button
                  type="button"
                  onClick={refreshOrders}
                  disabled={ordersLoading || cancelAnyUi}
                  style={btnSoft(ordersLoading || cancelAnyUi)}
                  title="Refresh orders"
                >
                  {ordersLoading ? "Refreshing…" : "Refresh"}
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
                  // force re-render per second for countdowns
                  void nowTick;

                  const sortedIntents = [...intents].sort(
                    (a, b) =>
                      Number(b.executeAfter ?? 0) - Number(a.executeAfter ?? 0)
                  );

                  // Only show the last 10 (newest) payment intents
                  const visibleIntents = sortedIntents.slice(0, 10);

                  return visibleIntents.map((intent) => {
                    const key = String(intent.ref || "");
                    const isOpen = Boolean(openOrderKeys[key]);
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

                      return lines.map((ln: any) => {
                        const qty =
                          Number(ln?.qty ?? ln?.units ?? ln?.quantity ?? 0) ||
                          0;

                        const sku = String(ln?.sku || ln?.skuId || "");
                        const unitPrice = priceBySku[sku] ?? 0;
                        const lineTotal = qty * unitPrice;

                        return {
                          supplierName: sup.name,
                          supplierAddr: sup.address,
                          executeAfter: execAt,
                          orderId: String(
                            (it as any).orderId || (it as any).id || ""
                          ),
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

                    const arrivalLabelForSupplier = (
                      supplierAddr: string,
                      executeAfterUnix: number
                    ) => {
                      const sup = supplierLabel(String(supplierAddr || ""));
                      const leadDays = Number(sup.leadTimeDays ?? 0);
                      const etaUnix =
                        Number(executeAfterUnix || 0) +
                        Math.max(0, leadDays) * 24 * 60 * 60;
                      return etaUnix ? fmtWhen(etaUnix) : "—";
                    };

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
                            <div style={{ fontWeight: 950 }}>Order</div>

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
                                  gridTemplateColumns: "1fr 1fr",
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
                                  <div>
                                    {fmtWhen(Number(intent.executeAfter))}
                                  </div>
                                </div>

                                <div>
                                  <div
                                    style={{
                                      fontWeight: 950,
                                      color: COLORS.text,
                                    }}
                                  >
                                    Items
                                  </div>
                                  <div>{items.length}</div>
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
                                          {r.uom ? ` ${r.uom}` : ""}
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
                                          <div
                                            style={{
                                              fontFamily:
                                                "ui-monospace, Menlo, monospace",
                                              color: COLORS.subtext,
                                              fontWeight: 800,
                                              fontSize: 12,
                                            }}
                                          >
                                            {shortenId(r.supplierAddr)}
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
                                          {r.unitPrice > 0
                                            ? `$${r.unitPrice.toFixed(2)}`
                                            : "—"}
                                        </td>

                                        {/* Arrival Time */}
                                        <td
                                          style={{
                                            padding: 12,
                                            borderTop: "1px solid #eef2f7",
                                            fontWeight: 850,
                                            color: COLORS.subtext,
                                            whiteSpace: "nowrap",
                                          }}
                                        >
                                          {arrivalLabelForSupplier(
                                            r.supplierAddr,
                                            r.executeAfter
                                          )}
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
