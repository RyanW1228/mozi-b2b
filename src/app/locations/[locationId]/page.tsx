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
  align = "right",
  children,
}: {
  title?: string;
  align?: "left" | "right";
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
          aria-label="Help"
          style={{
            position: "absolute",
            top: 28,
            ...(align === "left" ? { left: 0 } : { right: 0 }),
            width: 360,
            maxWidth: "min(360px, calc(100vw - 32px))",
            padding: 12,
            borderRadius: 12,
            border: `1px solid ${COLORS.border}`,
            background: "rgba(255,255,255,0.98)",
            boxShadow: "0 12px 28px rgba(0,0,0,0.12)",
            color: COLORS.text,
            fontWeight: 750,
            zIndex: 2000,
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
    if (!Number.isFinite(d) || d <= 0) return false;
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

  useEffect(() => {
    if (!locationId) return;

    let stopped = false;

    const tick = async () => {
      if (stopped) return;
      if (typeof document !== "undefined" && document.hidden) return;

      const owner = getSavedOwnerAddress();
      const env = getSavedEnv();

      // Optional: only execute for this owner+location
      const url =
        `/api/orders/execute?env=${encodeURIComponent(env)}` +
        `&locationId=${encodeURIComponent(locationId)}` +
        (owner ? `&owner=${encodeURIComponent(owner)}` : "") +
        `&limit=120`;

      try {
        await fetch(url, { method: "POST" });
        // then refresh UI so executed orders disappear
        await refreshOrders();
      } catch {
        // ignore for MVP
      }
    };

    // run every 30s
    const id = window.setInterval(() => tick(), 30_000);
    // run once immediately
    tick();

    return () => {
      stopped = true;
      window.clearInterval(id);
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId]);

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

  function getSavedOwnerAddress(): string | null {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem("mozi_wallet_address");
  }

  function fmtExecutionCountdown(executeAfterUnix: number) {
    if (!executeAfterUnix) return "Execution time unknown";

    const ms = executeAfterUnix * 1000 - Date.now();
    if (ms <= 0) return "Ready to execute";

    const totalSec = Math.floor(ms / 1000);
    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;

    if (hours > 0) return `Execution in ${hours}h ${minutes}m`;
    if (minutes > 0) return `Execution in ${minutes}m ${seconds}s`;
    return `Execution in ${seconds}s`;
  }

  function fmtWhen(ts: number) {
    if (!ts) return "—";
    try {
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

      const scoped = raw.filter(
        (i) =>
          String(i.restaurantId || "").toLowerCase() ===
          String(locationRestaurantId || "").toLowerCase()
      );

      // ✅ Remove canceled lines so canceled orders never render
      const cleaned = scoped
        .map((intent) => {
          const items = Array.isArray(intent.items) ? intent.items : [];
          const filteredItems = items.filter(
            (it) => !intent.canceled && !it.canceled
          );
          return { ...intent, items: filteredItems };
        })
        .filter((intent) => (intent.items ?? []).length > 0);

      setIntents(cleaned);

      // manual/autonomous mode read
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
      setOrdersError(String(e?.message ?? e));
    } finally {
      setOrdersLoading(false);
      refreshOrdersInFlight.current = false;
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

      const injected = getInjectedProvider();
      if (!injected) {
        setOrdersError("No injected wallet found (window.ethereum missing).");
        return;
      }

      const provider = new BrowserProvider(injected);
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

  async function cancelIntentCard(intent: IntentRow) {
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

    if (cancelAnyInFlight.current) return;
    cancelAnyInFlight.current = true;
    setCancelAnyUi(true);

    const key = String(intent.ref || "");
    const items = Array.isArray(intent.items) ? intent.items : [];

    // Collect cancellable ids
    const ids: bigint[] = [];
    for (const it of items) {
      if (it.canceled || it.executed) continue;
      const raw = String(it.orderId ?? "").trim();
      if (!raw) continue;
      try {
        ids.push(BigInt(raw));
      } catch {}
    }

    if (ids.length === 0) {
      setOrdersError("No cancellable order IDs found in this intent.");
      cancelAnyInFlight.current = false;
      setCancelAnyUi(false);
      return;
    }

    try {
      setOrdersError("");
      setCancelingOrderKey(key);

      // Optimistic UI: remove the whole intent immediately
      setIntents((prev) =>
        prev.filter((x) => String(x.ref) !== String(intent.ref))
      );
      setOpenOrderKeys((prev) => {
        const copy = { ...prev };
        delete copy[key];
        return copy;
      });

      const injected = getInjectedProvider();
      if (!injected) {
        setOrdersError("No injected wallet found (window.ethereum missing).");
        return;
      }

      const provider = new BrowserProvider(injected);
      const signer = await provider.getSigner();

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

      for (const id of ids) {
        const tx = await (hub as any).cancelOrder(id);
        try {
          await provider.waitForTransaction(tx.hash, 1, 60_000);
        } catch {
          // ignore timeout
        }
      }

      await refreshOrders();
    } catch (e: any) {
      setOrdersError(String(e?.shortMessage || e?.reason || e?.message || e));
    } finally {
      setCancelingOrderKey(null);
      cancelAnyInFlight.current = false;
      setCancelAnyUi(false);
    }
  }

  async function cancelOrderCard(o: {
    key: string;
    supplier: string;
    executeAfter: number;
    lines: Array<{ orderId?: string; canceled: boolean; executed: boolean }>;
  }) {
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

    // ✅ Prevent concurrent cancels (MetaMask can only reliably handle one prompt at a time)
    if (cancelAnyInFlight.current) return;
    cancelAnyInFlight.current = true;
    setCancelAnyUi(true);

    // Collect all cancellable orderIds in this card
    const ids: bigint[] = [];
    for (const ln of o.lines || []) {
      const raw = String(ln?.orderId ?? "").trim();
      if (!raw) continue;

      // Skip lines already canceled/executed (defensive)
      if (ln.canceled || ln.executed) continue;

      try {
        // uint256 orderId -> bigint
        ids.push(BigInt(raw));
      } catch {
        // ignore bad ids
      }
    }

    if (ids.length === 0) {
      setOrdersError("No cancellable order IDs found in this order card.");
      cancelAnyInFlight.current = false;
      setCancelAnyUi(false);
      return;
    }

    try {
      setOrdersError("");
      setCancelingOrderKey(o.key);
      // ✅ Optimistic UI: remove this order card immediately (don’t wait for chain/indexer)
      setIntents((prev) => {
        const supKey = String(o.supplier || "").toLowerCase();
        const execKey = Number(o.executeAfter || 0);

        const next = prev
          .map((intent) => {
            const items = Array.isArray(intent.items) ? intent.items : [];

            const filtered = items.filter((it: any) => {
              const itSup = String(it?.supplier || "").toLowerCase();
              const itExec = Number(
                it?.executeAfter ?? intent.executeAfter ?? 0
              );

              // If this line item belongs to the card being canceled, drop it
              const matchesCard = itSup === supKey && itExec === execKey;
              return !matchesCard;
            });

            return { ...intent, items: filtered };
          })
          // drop empty intents
          .filter((intent) => (intent.items ?? []).length > 0);

        return next;
      });

      // Also close its expanded state if it was open
      setOpenOrderKeys((prev) => {
        const copy = { ...prev };
        delete copy[o.key];
        return copy;
      });

      const injected = getInjectedProvider();
      if (!injected) {
        setOrdersError("No injected wallet found (window.ethereum missing).");
        return;
      }

      const provider = new BrowserProvider(injected);
      const signer = await provider.getSigner();

      // Safety: ensure signer matches saved owner
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

      // Cancel every order in this card (1 tx per orderId)
      for (const id of ids) {
        try {
          const tx = await (hub as any).cancelOrder(id);

          // Wait up to 60s for 1 confirmation. If it doesn't confirm, we still proceed.
          try {
            await provider.waitForTransaction(tx.hash, 1, 60_000);
          } catch {
            // timeout (tx may still confirm later) — continue
          }
        } catch (e: any) {
          // If one cancel fails, stop and show why (so you don't hang silently)
          setOrdersError(
            `Cancel failed for orderId=${id.toString()}: ` +
              String(e?.shortMessage || e?.reason || e?.message || e)
          );
          break;
        }
      }

      await refreshOrders();
    } catch (e: any) {
      setOrdersError(String(e?.shortMessage || e?.reason || e?.message || e));
    } finally {
      setCancelingOrderKey(null);
      cancelAnyInFlight.current = false;
      setCancelAnyUi(false);
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

    setLoading(true);
    manualGenerateInFlight.current = true;

    setError("");
    setPlan(null); // optional: if you want to stop showing the plan UI
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

      // This creates new on-chain orders through your proposer route
      const res = await fetch(
        `/api/orders/propose?locationId=${encodeURIComponent(locationId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            env,
            ownerAddress: owner,
            pendingWindowHours: 24,
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

      // refresh list immediately so the new orders appear
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

  useEffect(() => {
    if (!locationId) return;

    let canceled = false;

    // Function to check if we should auto-update orders
    const checkAndUpdateOrders = async () => {
      if (canceled) return;
      if (typeof document !== "undefined" && document.hidden) return;

      const nowMs = Date.now();
      const timeSinceLastUpdate = nowMs - lastOrdersAutoUpdateAt.current;

      // Only update if 12 hours have passed since last auto-update
      if (timeSinceLastUpdate >= ordersAutoUpdateIntervalMs) {
        lastOrdersAutoUpdateAt.current = nowMs;
        await refreshOrders();
      }
    };

    // Check immediately on mount
    checkAndUpdateOrders();

    // Then check every hour (every 60 minutes), reducing unnecessary checks
    const id = window.setInterval(() => {
      checkAndUpdateOrders();
    }, 60 * 60 * 1000); // 1 hour

    return () => {
      canceled = true;
      window.clearInterval(id);
    };

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
                <HelpDot title="Explain plan settings">...</HelpDot>
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
                {/* Strategy + Planning Horizon */}
                <div style={{ display: "grid", gap: 10, gridColumn: "1 / -1" }}>
                  {/* Strategy */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ fontWeight: 900, color: COLORS.subtext }}>
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

                  {/* Planning Horizon */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ fontWeight: 900, color: COLORS.subtext }}>
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

                {/* Input row: context + days + add */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 160px auto",
                    gap: 10,
                    alignItems: "center",
                  }}
                >
                  <input
                    value={contextDraft}
                    onChange={(e) => setContextDraft(e.target.value)}
                    placeholder='e.g. "Big game Sunday → expect +20% wings"'
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

                  <input
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={contextDaysDraft}
                    onChange={(e) =>
                      setContextDaysDraft(sanitizeIntDraft(e.target.value))
                    }
                    onBlur={() => {
                      const normalized = draftToClampedInt(
                        contextDaysDraft,
                        1,
                        365
                      );
                      setContextDaysDraft(String(normalized));
                    }}
                    onFocus={(e) => e.currentTarget.select()}
                    placeholder="Days"
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

                  <button
                    type="button"
                    onClick={() => {
                      const owner = getSavedOwnerAddress();
                      const env = getSavedEnv();
                      if (!owner || !locationId) return;

                      const text = contextDraft.trim();
                      const days = draftToClampedInt(contextDaysDraft, 1, 365);

                      if (!text) return;

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
                      // keep days as-is (nice UX), or reset if you want:
                      // setContextDaysDraft("7");
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
                      const expiresAtMs =
                        it.createdAtMs + it.durationDays * 24 * 60 * 60 * 1000;

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
                            <div>Applies for: {it.durationDays} days</div>
                            <div>
                              Expires: {new Date(expiresAtMs).toLocaleString()}
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

                  return sortedIntents.map((intent) => {
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

                    // Totals + supplier summary
                    const totalRaw = items.reduce((acc, it) => {
                      try {
                        return acc + BigInt(String(it.amount ?? "0"));
                      } catch {
                        return acc;
                      }
                    }, BigInt(0));

                    let costStr = "—";
                    try {
                      const usd = Number(formatUnits(totalRaw, 18));
                      costStr = `$${usd.toFixed(2)}`;
                    } catch {}

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

                    const nowUnix = Math.floor(Date.now() / 1000);
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

                            {/* Row 3: Execution timer (intent-level) */}
                            <div
                              style={{
                                color: COLORS.subtext,
                                fontWeight: 800,
                                fontSize: 13,
                              }}
                            >
                              {fmtExecutionCountdown(
                                Number(intent.executeAfter)
                              )}
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
                              onClick={() => cancelIntentCard(intent)}
                              disabled={
                                cancelAnyUi || cancelingOrderKey === key
                              }
                              title="Cancel all orders in this intent (owner override)"
                              style={{
                                padding: "10px 14px",
                                borderRadius: 12,
                                border: `1px solid ${COLORS.dangerBorder}`,
                                background: COLORS.dangerBg,
                                color: COLORS.dangerText,
                                fontWeight: 950,
                                cursor:
                                  cancelAnyUi || cancelingOrderKey === key
                                    ? "not-allowed"
                                    : "pointer",
                                opacity:
                                  cancelAnyUi || cancelingOrderKey === key
                                    ? 0.7
                                    : 1,
                              }}
                            >
                              {cancelAnyUi || cancelingOrderKey === key
                                ? "Deleting…"
                                : "Delete"}
                            </button>

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
                                        Supplier
                                      </th>
                                      <th
                                        style={{
                                          textAlign: "left",
                                          padding: 12,
                                          fontWeight: 950,
                                        }}
                                      >
                                        Execution
                                      </th>
                                      <th
                                        style={{
                                          textAlign: "right",
                                          padding: 12,
                                          fontWeight: 950,
                                        }}
                                      >
                                        Cost
                                      </th>
                                    </tr>
                                  </thead>

                                  <tbody>
                                    {items.map((it, idx) => {
                                      const sup = supplierLabel(
                                        String(it.supplier || "")
                                      );
                                      const execAt = Number(
                                        it.executeAfter ??
                                          intent.executeAfter ??
                                          0
                                      );
                                      const cost = fmtCostUsdFromRawAmount(
                                        String(it.amount ?? "0")
                                      );

                                      return (
                                        <tr key={idx}>
                                          <td
                                            style={{
                                              padding: 12,
                                              borderTop: "1px solid #eef2f7",
                                              fontWeight: 850,
                                              color: COLORS.text,
                                            }}
                                          >
                                            <div style={{ fontWeight: 950 }}>
                                              {sup.name}
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
                                              {shortenId(sup.address)}
                                            </div>
                                          </td>

                                          <td
                                            style={{
                                              padding: 12,
                                              borderTop: "1px solid #eef2f7",
                                              fontWeight: 850,
                                              color: COLORS.subtext,
                                            }}
                                          >
                                            {fmtExecutionCountdown(execAt)}
                                          </td>

                                          <td
                                            style={{
                                              padding: 12,
                                              borderTop: "1px solid #eef2f7",
                                              textAlign: "right",
                                              fontWeight: 950,
                                            }}
                                          >
                                            ${cost}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>

                                  <tfoot>
                                    <tr>
                                      <td
                                        style={{
                                          padding: 12,
                                          borderTop: `2px solid ${COLORS.border}`,
                                          fontWeight: 950,
                                          color: COLORS.text,
                                        }}
                                        colSpan={2}
                                      >
                                        Total
                                      </td>
                                      <td
                                        style={{
                                          padding: 12,
                                          borderTop: `2px solid ${COLORS.border}`,
                                          textAlign: "right",
                                          fontWeight: 950,
                                          color: COLORS.text,
                                        }}
                                      >
                                        {costStr}
                                      </td>
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
