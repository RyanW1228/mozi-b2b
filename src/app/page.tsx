// src/app/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  BrowserProvider,
  Contract,
  formatEther,
  formatUnits,
  parseUnits,
  isAddress,
} from "ethers";

const COLORS = {
  bg: "#f8fafc",
  card: "#ffffff",
  border: "#e5e7eb",
  text: "#0f172a",
  subtext: "#64748b",

  primary: "#2563eb", // blue
  primaryHover: "#1d4ed8",
  secondary: "#10b981", // green
  warning: "#f59e0b", // amber
  danger: "#dc2626", // red

  buttonTextLight: "#ffffff",
};

type MoziEnv = "testing" | "production";

const DEFAULT_ENV: MoziEnv =
  (process.env.NEXT_PUBLIC_MOZI_ENV_DEFAULT as MoziEnv) ?? "testing";

const TESTING = {
  name: "Testing (Sepolia)",
  chainId: 11155111,
  chainIdHex: "0xaa36a7",
  tokenAddress: process.env.NEXT_PUBLIC_MOCK_MNEE_ADDRESS ?? "",
  tokenLabel: "mMNEE",
  isMintable: true,
};

const PRODUCTION = {
  name: "Production (Mainnet)",
  chainId: 1,
  chainIdHex: "0x1",
  tokenAddress: process.env.NEXT_PUBLIC_MNEE_MAINNET_ADDRESS ?? "",
  tokenLabel: "MNEE",
  isMintable: false,
};

const ERC20_READ_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
] as const;

const MOCK_MINT_ABI = ["function mint(address to, uint256 amount)"] as const;

const TREASURY_HUB_ABI = [
  "function token() view returns (address)",
  "function deposit(uint256 amount) external",
  "function withdraw(uint256 amount) external",
  "function withdrawAvailable() external",
  "function balanceOf(address owner) view returns (uint256)",
  "function reservedOf(address owner) view returns (uint256)",
  "function availableToWithdraw(address owner) view returns (uint256)",

  // Agent permission (still needed for auto-proposals)
  "function setAgent(address agent, bool allowed) external",
  "function isAgentFor(address owner, address agent) view returns (bool)",

  // ✅ Execution mode (THIS is what your toggle controls now)
  "function setRequireApprovalForExecution(bool required) external",
  "function requireApprovalForExecution(address owner) view returns (bool)",
] as const;

const ERC20_APPROVE_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
] as const;

const TREASURY_HUB_ADDRESS =
  process.env.NEXT_PUBLIC_MOZI_TREASURY_HUB_ADDRESS ?? "";

const MOZI_AGENT_ADDRESS = process.env.NEXT_PUBLIC_MOZI_AGENT_ADDRESS ?? "";

const LS_WALLET_ADDRESS = "mozi_wallet_address";
const LS_WALLET_CHAIN = "mozi_wallet_chain";

function saveWallet(addr: string | null, chain: string | null) {
  if (typeof window === "undefined") return;
  if (addr) window.localStorage.setItem(LS_WALLET_ADDRESS, addr);
  else window.localStorage.removeItem(LS_WALLET_ADDRESS);

  if (chain) window.localStorage.setItem(LS_WALLET_CHAIN, chain);
  else window.localStorage.removeItem(LS_WALLET_CHAIN);
}

function loadWallet() {
  if (typeof window === "undefined")
    return { addr: null as string | null, chain: null as string | null };
  return {
    addr: window.localStorage.getItem(LS_WALLET_ADDRESS),
    chain: window.localStorage.getItem(LS_WALLET_CHAIN),
  };
}

function shorten(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function trimTo6Decimals(s: string) {
  if (!s.includes(".")) return s;
  return s.replace(/(\.\d{0,6})\d+$/, "$1").replace(/\.$/, "");
}

function chainLabel(chainIdHex: string | null) {
  if (!chainIdHex) return "—";
  const c = chainIdHex.toLowerCase();
  if (c === "0xaa36a7") return "Sepolia (11155111)";
  if (c === "0x1") return "Mainnet (1)";
  return chainIdHex;
}

export default function Home() {
  const hasProvider = useMemo(
    () => typeof window !== "undefined" && !!(window as any).ethereum,
    []
  );

  const [env, setEnv] = useState<MoziEnv>("testing");

  const [address, setAddress] = useState<string | null>(null);
  const [chainIdHex, setChainIdHex] = useState<string | null>(null);
  const addressRef = useRef<string | null>(null);
  const chainIdHexRef = useRef<string | null>(null);

  const [ethBalance, setEthBalance] = useState<string | null>(null);
  const [tokenBalance, setTokenBalance] = useState<string | null>(null);
  const [tokenSymbol, setTokenSymbol] = useState<string | null>(null);

  const [isConnecting, setIsConnecting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [walletReady, setWalletReady] = useState(false);
  const [isSwitchingNetwork, setIsSwitchingNetwork] = useState(false);
  const [showSwitchNetwork, setShowSwitchNetwork] = useState(false);

  // Mint UI (Testing only)
  const [mintAmount, setMintAmount] = useState<string>("1000");
  const [isMinting, setIsMinting] = useState(false);

  // Treasury UI
  const [availableToWithdraw, setAvailableToWithdraw] = useState<string | null>(
    null
  );
  const [lockedMnee, setLockedMnee] = useState<string | null>(null);

  const [treasuryAvailable, setTreasuryAvailable] = useState<string | null>(
    null
  );
  const [depositAmount, setDepositAmount] = useState<string>("100");
  const [withdrawAmount, setWithdrawAmount] = useState<string>("100");
  const [isWithdrawing, setIsWithdrawing] = useState(false);

  const [isDepositing, setIsDepositing] = useState(false);

  const [agentEnabled, setAgentEnabled] = useState<boolean | null>(null);

  // execution mode: true => Manual (approval required), false => Autonomous
  const [requireApproval, setRequireApproval] = useState<boolean | null>(null);

  const [isEnablingAgent, setIsEnablingAgent] = useState(false);
  const attemptedEnableRef = useRef<string>(""); // `${env}:${owner}:${chainIdHex}`

  const [isTogglingMode, setIsTogglingMode] = useState(false);

  const [showAutonomyInfo, setShowAutonomyInfo] = useState(false);
  const autonomyInfoWrapRef = useRef<HTMLDivElement | null>(null);

  const cfg = env === "testing" ? TESTING : PRODUCTION;

  const isCorrectChain =
    !!chainIdHex && chainIdHex.toLowerCase() === cfg.chainIdHex.toLowerCase();

  // Hard guard: only allow enabling autonomy if treasury has funds (available or locked)
  const hasTreasuryFunds =
    (availableToWithdraw !== null && availableToWithdraw !== "0") ||
    (lockedMnee !== null && lockedMnee !== "0");

  useEffect(() => {
    addressRef.current = address;
  }, [address]);

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
    chainIdHexRef.current = chainIdHex;
  }, [chainIdHex]);

  useEffect(() => {
    if (!hasProvider) return;

    const ethereum = (window as any).ethereum;

    (async () => {
      const saved = loadWallet();
      if (!saved.addr) return;

      try {
        // IMPORTANT: confirm the wallet is actually connected to this site
        const accounts: string[] = await ethereum.request({
          method: "eth_accounts",
        });
        const normalized = accounts.map((x) => x.toLowerCase());
        const ok = normalized.includes(saved.addr.toLowerCase());

        if (!ok) {
          // saved address is stale (user disconnected / switched browser / etc.)
          saveWallet(null, null);
          return;
        }

        const c: string = await ethereum.request({ method: "eth_chainId" });

        setAddress(saved.addr);
        setChainIdHex(c);
        saveWallet(saved.addr, c);

        // optional: refresh once restored
        setEthBalance(null);
        setTokenBalance(null);
        setTokenSymbol(null);
        await refreshBalances();
      } catch {
        // If anything fails, just clear saved state
        saveWallet(null, null);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasProvider]);

  // Shared styles
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
    borderRadius: 10,
    background: COLORS.primary,
    color: COLORS.buttonTextLight,
    border: "none",
    fontWeight: 800,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.65 : 1,
  });

  const btnOutline = (disabled?: boolean): React.CSSProperties => ({
    padding: "10px 14px",
    borderRadius: 10,
    background: "#ffffff",
    color: COLORS.text,
    border: `1px solid ${COLORS.border}`,
    fontWeight: 800,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.65 : 1,
  });

  const btnWarning = (disabled?: boolean): React.CSSProperties => ({
    padding: "10px 14px",
    borderRadius: 10,
    background: COLORS.warning,
    color: COLORS.buttonTextLight,
    border: "none",
    fontWeight: 900,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.65 : 1,
  });

  const btnRefreshNeutral = (disabled?: boolean): React.CSSProperties => ({
    padding: "10px 14px",
    borderRadius: 10,
    background: "#f8fafc", // soft grey fill
    color: COLORS.text,
    border: "1.5px solid #cbd5e1", // darker outline
    fontWeight: 800,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
  });

  const pill = (bg: string, active: boolean): React.CSSProperties => ({
    padding: "10px 14px",
    borderRadius: 10,
    background: active ? bg : "#ffffff",
    color: active ? COLORS.buttonTextLight : COLORS.text,
    border: active ? "none" : `1px solid ${COLORS.border}`,
    fontWeight: 900,
    cursor: "pointer",
  });

  function shouldSuppressWalletError(e: any) {
    const msg = String(e?.message ?? e);

    // Common user-rejection / cancellation messages across wallets
    return (
      msg.includes("User rejected") ||
      msg.includes("user rejected") ||
      msg.includes("denied") ||
      msg.includes("rejected") ||
      msg.includes("canceled") ||
      msg.includes("cancelled") ||
      msg.includes("ACTION_REJECTED") // ethers v6
    );
  }

  async function connect() {
    if (!hasProvider) {
      setError("No injected wallet found. Install MetaMask.");
      return;
    }

    try {
      setError(null);
      setIsConnecting(true);

      const ethereum = (window as any).ethereum;

      // Force MetaMask to show the account selection / permissions prompt
      // so you can switch wallets even if already connected.
      try {
        await ethereum.request({
          method: "wallet_requestPermissions",
          params: [{ eth_accounts: {} }],
        });
      } catch (permErr: any) {
        // Some wallets/providers don't support this method. If it's unsupported,
        // just continue to eth_requestAccounts instead of failing.
        const msg = String(permErr?.message ?? permErr);

        const unsupported =
          msg.includes("wallet_requestPermissions") ||
          msg.includes("Method not found") ||
          msg.includes("does not exist") ||
          msg.includes("-32601");

        if (!unsupported) {
          // User likely canceled / rejected permissions prompt
          setError(permErr?.message ?? "Wallet connection canceled.");
          return;
        }
        // else: ignore and continue
      }

      const accounts: string[] = await ethereum.request({
        method: "eth_requestAccounts",
      });

      const a = accounts?.[0] ?? null;
      const c: string = await ethereum.request({ method: "eth_chainId" });

      setAddress(a);
      setChainIdHex(c);
      saveWallet(a, c);

      // Optional: immediately refresh once connected
      if (a) {
        setShowSwitchNetwork(false);
        setEthBalance(null);
        setTokenBalance(null);
        setTokenSymbol(null);
        await refreshBalances();
      }
    } catch (e: any) {
      setError(e?.message ?? "Failed to connect wallet.");
    } finally {
      setIsConnecting(false);
    }
  }

  function logout() {
    setAddress(null);
    setChainIdHex(null);
    setEthBalance(null);
    setTokenBalance(null);
    setTokenSymbol(null);
    setError(null);
    saveWallet(null, null);
  }

  async function switchToEnvChain(mode: "auto" | "manual" = "manual") {
    if (!hasProvider) return false;

    const ethereum = (window as any).ethereum;

    try {
      setIsSwitchingNetwork(true);

      // In auto mode, don't spam errors (rejection is normal)
      if (mode === "manual") setError(null);

      await ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: cfg.chainIdHex }],
      });

      const c: string = await ethereum.request({ method: "eth_chainId" });
      setChainIdHex(c);

      // Success: never show the button
      setShowSwitchNetwork(false);

      // Auto-refresh after switching if we have an address
      if (address) {
        // clear old balances immediately to avoid stale display
        setEthBalance(null);
        setTokenBalance(null);
        setTokenSymbol(null);
        await refreshBalances();
      }

      return true;
    } catch (e: any) {
      // Auto mode: just show CTA, no scary error
      if (mode === "auto") {
        setShowSwitchNetwork(true);
        return false;
      }

      // Manual mode: show error
      setError(e?.message ?? "Failed to switch network.");
      setShowSwitchNetwork(true);
      return false;
    } finally {
      setIsSwitchingNetwork(false);
    }
  }

  useEffect(() => {
    if (!address || !hasProvider) return;

    // Recompute correct-chain inline (avoids stale isCorrectChain issues)
    const correct =
      !!chainIdHex && chainIdHex.toLowerCase() === cfg.chainIdHex.toLowerCase();

    setShowSwitchNetwork(false);

    if (correct) {
      // Env changed but chain is already correct: refresh immediately
      refreshBalances();
      return;
    }

    // Wrong chain: try auto-switch; if user rejects, button will appear (no flash)
    switchToEnvChain("auto");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [env, address, chainIdHex, cfg.chainIdHex]);

  useEffect(() => {
    // If the user is connected, try to switch automatically when env changes
    if (!address || !hasProvider) return;

    // If already on the right chain, do nothing
    if (isCorrectChain) return;

    // Attempt switch. If user rejects, they'll still have the button.
    switchToEnvChain();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [env, address]);

  async function refreshBalances() {
    if (!hasProvider || !address) return;

    setIsRefreshing(true);
    setError(null);

    try {
      const ethereum = (window as any).ethereum;
      const provider = new BrowserProvider(ethereum);

      // ETH
      const balWei = await provider.getBalance(address);
      const eth = Number.parseFloat(formatEther(balWei));
      setEthBalance(
        eth.toLocaleString(undefined, { maximumFractionDigits: 6 })
      );

      // Token
      if (!cfg.tokenAddress) {
        setTokenSymbol(cfg.tokenLabel);
        setTokenBalance(null);
        setError(
          env === "testing"
            ? "Missing NEXT_PUBLIC_MOCK_MNEE_ADDRESS in .env.local"
            : "Missing NEXT_PUBLIC_MNEE_MAINNET_ADDRESS in .env.local"
        );
        return;
      }

      const token = new Contract(cfg.tokenAddress, ERC20_READ_ABI, provider);

      // Be defensive: some ABIs / ethers setups can make decimals() unavailable at runtime.
      // Fallback to 18 + cfg.tokenLabel so Refresh never crashes.
      let decimals = 18;
      let symbol = cfg.tokenLabel;

      try {
        if (typeof (token as any).decimals === "function") {
          decimals = await (token as any).decimals();
        }
      } catch {
        decimals = 18;
      }

      try {
        if (typeof (token as any).symbol === "function") {
          symbol = await (token as any).symbol();
        }
      } catch {
        symbol = cfg.tokenLabel;
      }

      const raw = (await token.balanceOf(address)) as bigint;

      setTokenSymbol(symbol || cfg.tokenLabel);
      setTokenBalance(trimTo6Decimals(formatUnits(raw, decimals)));

      if (TREASURY_HUB_ADDRESS && address) {
        // ✅ Validate addresses BEFORE passing them to ethers
        if (!isAddress(TREASURY_HUB_ADDRESS)) {
          setAvailableToWithdraw(null);
          setLockedMnee(null);
          setAgentEnabled(null);
          setError(`Invalid TREASURY_HUB_ADDRESS: ${TREASURY_HUB_ADDRESS}`);
          return;
        }

        const agentOk = MOZI_AGENT_ADDRESS
          ? isAddress(MOZI_AGENT_ADDRESS)
          : false;
        if (MOZI_AGENT_ADDRESS && !agentOk) {
          // Still allow showing balances; just treat autonomy as unknown.
          setAgentEnabled(null);
          setError(`Invalid MOZI_AGENT_ADDRESS: ${MOZI_AGENT_ADDRESS}`);
          // Do NOT return; continue reading balances without isAgentFor
        }

        try {
          const hub = new Contract(
            TREASURY_HUB_ADDRESS,
            TREASURY_HUB_ABI,
            provider
          );

          const [rawAvail, rawReserved, allowed, reqApproval] =
            await Promise.all([
              (hub as any).availableToWithdraw(address) as Promise<bigint>,
              (hub as any).reservedOf(address) as Promise<bigint>,
              agentOk
                ? ((hub as any).isAgentFor(
                    address,
                    MOZI_AGENT_ADDRESS
                  ) as Promise<boolean>)
                : Promise.resolve(false),
              (hub as any).requireApprovalForExecution(
                address
              ) as Promise<boolean>,
            ]);

          setAvailableToWithdraw(
            trimTo6Decimals(formatUnits(rawAvail, decimals))
          );
          setLockedMnee(trimTo6Decimals(formatUnits(rawReserved, decimals)));
          setAgentEnabled(Boolean(allowed));
          setRequireApproval(Boolean(reqApproval));
        } catch (e: any) {
          setAvailableToWithdraw(null);
          setLockedMnee(null);
          setAgentEnabled(null);
          setRequireApproval(null);

          const msg = e?.shortMessage || e?.reason || e?.message || String(e);
          setError(`Treasury read failed: ${msg}`);
        }
      } else {
        setAvailableToWithdraw(null);
        setLockedMnee(null);
        setAgentEnabled(null);
        setRequireApproval(null);
      }
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setIsRefreshing(false);
    }
  }

  async function mintMock() {
    if (env !== "testing") return;
    if (!hasProvider || !address) return;

    if (!cfg.tokenAddress) {
      setError("Missing NEXT_PUBLIC_MOCK_MNEE_ADDRESS in .env.local");
      return;
    }
    if (!isCorrectChain) {
      setError("Switch to Sepolia to mint mock tokens.");
      return;
    }

    try {
      setError(null);
      setIsMinting(true);

      const ethereum = (window as any).ethereum;
      const provider = new BrowserProvider(ethereum);
      const signer = await provider.getSigner();

      const amount = parseUnits(mintAmount || "0", 18);

      const token = new Contract(cfg.tokenAddress, MOCK_MINT_ABI, signer);
      const tx = await token.mint(address, amount);
      await tx.wait();

      await refreshBalances();
    } catch (e: any) {
      if (!shouldSuppressWalletError(e)) {
        setError(e?.message ?? String(e));
      }
    } finally {
      setIsMinting(false);
    }
  }

  async function depositToTreasury() {
    // Only makes sense when connected
    if (!hasProvider || !address) return;

    // Must be on correct chain for the selected env
    if (!isCorrectChain) {
      setError(`Switch to ${cfg.name} to deposit.`);
      return;
    }

    // Must have token + treasury configured
    if (!cfg.tokenAddress) {
      setError(
        env === "testing"
          ? "Missing NEXT_PUBLIC_MOCK_MNEE_ADDRESS in .env.local"
          : "Missing NEXT_PUBLIC_MNEE_MAINNET_ADDRESS in .env.local"
      );
      return;
    }

    if (!TREASURY_HUB_ADDRESS) {
      setError("Missing NEXT_PUBLIC_MOZI_TREASURY_HUB_ADDRESS in .env.local");
      return;
    }

    try {
      setError(null);
      setIsDepositing(true);

      const ethereum = (window as any).ethereum;
      const provider = new BrowserProvider(ethereum);
      const signer = await provider.getSigner();

      // IMPORTANT: we assume 18 decimals (MockMNEE should be 18)
      const amt = parseUnits(depositAmount || "0", 18);
      if (amt <= BigInt(0)) {
        setError("Deposit amount must be > 0");
        return;
      }

      // 1) Approve treasury to pull tokens
      const token = new Contract(
        cfg.tokenAddress,
        ["function approve(address,uint256) returns (bool)"],
        signer
      );
      const approveTx = await (token as any).approve(TREASURY_HUB_ADDRESS, amt);
      await approveTx.wait();

      // 2) Deposit into treasury (treasury pulls via transferFrom)
      const hub = new Contract(TREASURY_HUB_ADDRESS, TREASURY_HUB_ABI, signer);
      const depTx = await (hub as any).deposit(amt);

      await depTx.wait();

      // Refresh displayed balances
      await refreshBalances();
    } catch (e: any) {
      if (!shouldSuppressWalletError(e)) {
        setError(e?.message ?? String(e));
      }
    } finally {
      setIsDepositing(false);
    }
  }

  async function withdrawFromTreasury() {
    if (!hasProvider || !address) return;

    if (!isCorrectChain) {
      setError(`Switch to ${cfg.name} to withdraw.`);
      return;
    }

    if (!TREASURY_HUB_ADDRESS) {
      setError("Missing NEXT_PUBLIC_MOZI_TREASURY_HUB_ADDRESS in .env.local");
      return;
    }

    try {
      setError(null);
      setIsWithdrawing(true);

      const ethereum = (window as any).ethereum;
      const provider = new BrowserProvider(ethereum);
      const signer = await provider.getSigner();

      const amt = parseUnits(withdrawAmount || "0", 18);
      if (amt <= BigInt(0)) {
        setError("Withdraw amount must be > 0");
        return;
      }

      const hub = new Contract(TREASURY_HUB_ADDRESS, TREASURY_HUB_ABI, signer);
      const tx = await (hub as any).withdraw(amt);
      await tx.wait();

      await refreshBalances();
    } catch (e: any) {
      if (!shouldSuppressWalletError(e)) {
        setError(e?.message ?? String(e));
      }
    } finally {
      setIsWithdrawing(false);
    }
  }

  async function setExecutionMode(nextAutonomous: boolean) {
    if (!hasProvider || !address) return;

    if (!isCorrectChain) {
      setError(`Switch to ${cfg.name} to change mode.`);
      return;
    }

    if (!TREASURY_HUB_ADDRESS) {
      setError("Missing NEXT_PUBLIC_MOZI_TREASURY_HUB_ADDRESS in .env.local");
      return;
    }

    try {
      setError(null);
      setIsTogglingMode(true);

      const ethereum = (window as any).ethereum;
      const provider = new BrowserProvider(ethereum);
      const signer = await provider.getSigner();

      const hub = new Contract(TREASURY_HUB_ADDRESS, TREASURY_HUB_ABI, signer);

      // Manual = requireApprovalForExecution(true)
      // Autonomous = requireApprovalForExecution(false)
      const nextRequired = !nextAutonomous;

      const tx = await (hub as any).setRequireApprovalForExecution(
        nextRequired
      );
      await tx.wait();

      await refreshBalances();
    } catch (e: any) {
      if (!shouldSuppressWalletError(e)) {
        setError(e?.message ?? String(e));
      }
    } finally {
      setIsTogglingMode(false);
    }
  }

  async function ensureAgentEnabled() {
    if (!hasProvider || !address) return;
    if (!isCorrectChain) return;
    if (!TREASURY_HUB_ADDRESS || !MOZI_AGENT_ADDRESS) return;

    // Validate addresses
    if (!isAddress(TREASURY_HUB_ADDRESS) || !isAddress(MOZI_AGENT_ADDRESS))
      return;

    // Only attempt once per (env, owner, chain)
    const attemptKey = `${env}:${address.toLowerCase()}:${
      chainIdHex?.toLowerCase() ?? ""
    }`;
    if (attemptedEnableRef.current === attemptKey) return;

    // If we already know it's enabled, skip
    if (agentEnabled === true) {
      attemptedEnableRef.current = attemptKey;
      return;
    }

    try {
      setIsEnablingAgent(true);

      const ethereum = (window as any).ethereum;
      const provider = new BrowserProvider(ethereum);
      const signer = await provider.getSigner();

      const hub = new Contract(TREASURY_HUB_ADDRESS, TREASURY_HUB_ABI, signer);

      // Double-check on-chain (don’t rely only on state)
      const allowed = (await (hub as any).isAgentFor(
        address,
        MOZI_AGENT_ADDRESS
      )) as boolean;

      if (allowed) {
        setAgentEnabled(true);
        attemptedEnableRef.current = attemptKey;
        return;
      }

      const tx = await (hub as any).setAgent(MOZI_AGENT_ADDRESS, true);
      await tx.wait();

      attemptedEnableRef.current = attemptKey;
      await refreshBalances();
    } catch (e: any) {
      // If user rejects, don’t keep retrying forever
      attemptedEnableRef.current = attemptKey;

      if (!shouldSuppressWalletError(e)) {
        setError(e?.message ?? String(e));
      }
    } finally {
      setIsEnablingAgent(false);
    }
  }

  useEffect(() => {
    if (!address) return;
    if (!isCorrectChain) return;
    if (!TREASURY_HUB_ADDRESS || !MOZI_AGENT_ADDRESS) return;

    // Fire and forget (internal handles anti-spam)
    ensureAgentEnabled();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    address,
    env,
    chainIdHex,
    isCorrectChain,
    TREASURY_HUB_ADDRESS,
    MOZI_AGENT_ADDRESS,
  ]);

  // Persist env choice locally (UI-only toggle)
  useEffect(() => {
    const saved =
      typeof window !== "undefined"
        ? (window.localStorage.getItem("mozi_env") as MoziEnv | null)
        : null;
    setEnv(saved ?? DEFAULT_ENV);
  }, []);

  useEffect(() => {
    // Prevent wallet-warning flash on hard refresh (wait until after first client render)
    setWalletReady(true);
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("mozi_env", env);
    }
  }, [env]);

  // Listen for wallet changes
  useEffect(() => {
    if (!hasProvider) return;
    const ethereum = (window as any).ethereum;

    const onAccountsChanged = (accounts: string[]) => {
      const next = accounts?.[0] ?? null;
      setAddress(next);
      saveWallet(next, chainIdHexRef.current);

      setEthBalance(null);
      setTokenBalance(null);
      setTokenSymbol(null);
      setError(null);

      if (next) refreshBalances();
    };

    const onChainChanged = (c: string) => {
      setChainIdHex(c);
      saveWallet(addressRef.current, c);

      setEthBalance(null);
      setTokenBalance(null);
      setTokenSymbol(null);
      setError(null);

      setShowSwitchNetwork(false);
      refreshBalances();
    };

    ethereum.on?.("accountsChanged", onAccountsChanged);
    ethereum.on?.("chainChanged", onChainChanged);

    return () => {
      ethereum.removeListener?.("accountsChanged", onAccountsChanged);
      ethereum.removeListener?.("chainChanged", onChainChanged);
    };
  }, [hasProvider]);

  // Refresh balances when address or env changes
  useEffect(() => {
    if (address) refreshBalances();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, env]);

  return (
    <div
      style={{
        minHeight: "100vh",
        width: "100%",
        backgroundColor: "#dbeafe", // blue-100 base (noticeably bluer)

        backgroundImage: [
          // big blue glow top
          "radial-gradient(1400px 750px at 50% -220px, rgba(37,99,235,0.35) 0%, rgba(37,99,235,0.18) 42%, rgba(219,234,254,0) 75%)",

          // secondary blue glow left
          "radial-gradient(1100px 650px at 15% 25%, rgba(59,130,246,0.22) 0%, rgba(219,234,254,0) 62%)",

          // soft vertical wash so it feels designed
          "linear-gradient(180deg, #dbeafe 0%, #e0e7ff 45%, #eaf2ff 100%)",
        ].join(", "),

        backgroundRepeat: "no-repeat",
        backgroundSize: "200% 200%",
        animation: "moziBgDrift 60s ease-in-out infinite",

        backgroundAttachment: "fixed",
        display: "flex",
        justifyContent: "center",
        padding: "32px 16px",
      }}
    >
      <main
        style={{
          fontFamily: "system-ui",
          maxWidth: 900,
          width: "100%",
          color: COLORS.text,
          padding: 24,
        }}
      >
        <header
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto 1fr",
            alignItems: "center",
            marginBottom: 24,
          }}
        >
          {/* Left spacer (future use: env badge, status dot, etc.) */}
          <div />

          {/* Center title */}
          <h1
            style={{
              fontSize: 36,
              fontWeight: 900,
              letterSpacing: -0.4,
              margin: 0,
              textAlign: "center",
            }}
          >
            Mozi
          </h1>

          {/* Right navigation */}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Link
              href="/locations/loc-1"
              style={{
                padding: "10px 16px",
                borderRadius: 12,
                background: "#eff6ff",
                border: "1px solid #bfdbfe",
                color: "#1d4ed8",
                textDecoration: "none",
                fontWeight: 900,
              }}
            >
              Dashboard
            </Link>
          </div>
        </header>

        {/* Environment toggle */}
        <section style={cardStyle}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <div style={{ fontWeight: 900 }}>Environment</div>

            {address && !isCorrectChain && showSwitchNetwork && (
              <button
                onClick={() => switchToEnvChain("manual")}
                style={btnPrimary(isSwitchingNetwork)}
                disabled={isSwitchingNetwork}
              >
                {isSwitchingNetwork ? "Switching…" : "Switch Network"}
              </button>
            )}
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              onClick={() => setEnv("testing")}
              style={pill(COLORS.secondary, env === "testing")}
            >
              Testing (Sepolia)
            </button>
            <button
              onClick={() => setEnv("production")}
              style={pill(COLORS.warning, env === "production")}
            >
              Production (Mainnet)
            </button>
          </div>
        </section>

        {/* AI Autonomy */}
        {address && (
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
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ fontWeight: 900 }}>AI Autonomy</div>

                {/* Info bubble + popover */}
                <div
                  ref={autonomyInfoWrapRef}
                  style={{
                    position: "relative",
                    display: "inline-flex",
                    alignItems: "center",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setShowAutonomyInfo((v) => !v)}
                    aria-label="What does AI autonomy mean?"
                    aria-expanded={showAutonomyInfo}
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: "50%",
                      background: "#e5e7eb",
                      color: "#1f2937",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 12,
                      fontWeight: 900,
                      cursor: "pointer",
                      userSelect: "none",
                      border: "1px solid #cbd5e1",
                      padding: 0,
                      lineHeight: "20px",
                    }}
                  >
                    ?
                  </button>

                  {showAutonomyInfo && (
                    <div
                      style={{
                        position: "absolute",
                        top: 28,
                        left: 0,
                        zIndex: 50,
                        width: 320,
                        maxWidth: "min(320px, 80vw)",
                        background: "#ffffff",
                        border: "1px solid #e5e7eb",
                        borderRadius: 12,
                        boxShadow: "0 10px 20px rgba(0,0,0,0.12)",
                        padding: 12,
                      }}
                    >
                      {/* Little arrow */}
                      <div
                        style={{
                          position: "absolute",
                          top: -6,
                          left: 10,
                          width: 12,
                          height: 12,
                          background: "#ffffff",
                          borderLeft: "1px solid #e5e7eb",
                          borderTop: "1px solid #e5e7eb",
                          transform: "rotate(45deg)",
                        }}
                      />

                      <div style={{ fontWeight: 900, marginBottom: 6 }}>
                        What happens?
                      </div>

                      <div
                        style={{
                          color: COLORS.subtext,
                          fontWeight: 700,
                          fontSize: 13,
                        }}
                      >
                        When enabled, Mozi can reserve funds and execute
                        payments after the pending window unless you cancel/edit
                        the order before execution.
                      </div>

                      <div
                        style={{
                          marginTop: 10,
                          display: "flex",
                          justifyContent: "flex-end",
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => setShowAutonomyInfo(false)}
                          style={{
                            padding: "8px 12px",
                            borderRadius: 10,
                            border: "none",
                            background: COLORS.danger, // red fill
                            color: COLORS.buttonTextLight, // white text
                            fontWeight: 900,
                            cursor: "pointer",
                          }}
                        >
                          Close
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                {requireApproval === null ? (
                  <div style={{ color: COLORS.subtext, fontWeight: 800 }}>
                    Loading…
                  </div>
                ) : (
                  <div style={{ color: COLORS.subtext, fontWeight: 900 }}>
                    {requireApproval ? "Manual" : "Autonomous"}
                  </div>
                )}

                <button
                  onClick={() => {
                    // Toggle between Manual <-> Autonomous
                    const currentlyManual = Boolean(requireApproval);
                    const nextAutonomous = currentlyManual; // if manual -> autonomous, else -> manual
                    setExecutionMode(nextAutonomous);
                  }}
                  disabled={
                    isTogglingMode ||
                    requireApproval === null ||
                    !address ||
                    !TREASURY_HUB_ADDRESS ||
                    !isCorrectChain
                  }
                  style={{
                    width: 58,
                    height: 34,
                    borderRadius: 999,
                    border: "1px solid #cbd5e1",
                    background: !requireApproval ? "#0f172a" : "#e5e7eb",
                    padding: 4,
                    cursor:
                      isTogglingMode ||
                      requireApproval === null ||
                      !address ||
                      !TREASURY_HUB_ADDRESS ||
                      !isCorrectChain
                        ? "not-allowed"
                        : "pointer",
                    opacity:
                      isTogglingMode ||
                      requireApproval === null ||
                      !address ||
                      !TREASURY_HUB_ADDRESS ||
                      !isCorrectChain
                        ? 0.6
                        : 1,
                    transition: "background 150ms ease",
                    position: "relative",
                  }}
                  aria-label="Toggle AI autonomy"
                >
                  <div
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 999,
                      background: "#ffffff",
                      position: "absolute",
                      top: 3,
                      left: !requireApproval ? 29 : 3,
                      transition: "left 150ms ease",
                      boxShadow: "0 1px 2px rgba(0,0,0,0.12)",
                    }}
                  />
                </button>
                {isEnablingAgent && (
                  <div style={{ color: COLORS.subtext, fontWeight: 800 }}>
                    Enabling agent…
                  </div>
                )}

                {isTogglingMode && (
                  <div style={{ color: COLORS.subtext, fontWeight: 800 }}>
                    Updating…
                  </div>
                )}
              </div>
            </div>

            {agentEnabled === false && (
              <div
                style={{
                  color: "#92400e",
                  background: "#fffbeb",
                  border: "1px solid #fde68a",
                  padding: 10,
                  borderRadius: 12,
                  fontWeight: 700,
                }}
              >
                Mozi Agent is currently <b>not authorized</b> for this wallet.
                Proposals won’t appear until it’s enabled.
              </div>
            )}

            {!isCorrectChain && (
              <div
                style={{
                  color: "#92400e",
                  background: "#fffbeb",
                  border: "1px solid #fde68a",
                  padding: 10,
                  borderRadius: 12,
                  fontWeight: 700,
                }}
              >
                Switch to <b>{cfg.name}</b> to change autonomy.
              </div>
            )}

            {!MOZI_AGENT_ADDRESS && (
              <div
                style={{
                  color: "#92400e",
                  background: "#fffbeb",
                  border: "1px solid #fde68a",
                  padding: 10,
                  borderRadius: 12,
                  fontWeight: 700,
                }}
              >
                Missing <b>NEXT_PUBLIC_MOZI_AGENT_ADDRESS</b> in .env.local.
              </div>
            )}
          </section>
        )}

        {/* Treasury */}
        {address && (
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
              <div>
                <div style={{ fontWeight: 900 }}>Mozi Treasury</div>
              </div>

              <button
                onClick={refreshBalances}
                disabled={!address || isRefreshing}
                style={btnRefreshNeutral(!address || isRefreshing)}
              >
                {isRefreshing ? "Refreshing…" : "Refresh"}
              </button>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "220px 1fr",
                rowGap: 8,
                columnGap: 12,
                padding: 12,
                borderRadius: 12,
                border: `1px solid ${COLORS.border}`,
                background: "#fbfdff",
              }}
            >
              {/* Row: Available label (left) + value (right) + denomination pill (top-right) */}
              <div
                style={{
                  gridColumn: "1 / -1",
                  display: "grid",
                  gridTemplateColumns: "220px 1fr auto",
                  alignItems: "center",
                  columnGap: 12,
                }}
              >
                <div style={{ color: COLORS.subtext, fontWeight: 700 }}>
                  Available to Withdraw
                </div>

                <div style={{ fontWeight: 900 }}>
                  {availableToWithdraw ?? "…"}
                </div>

                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 800,
                    color: COLORS.subtext,
                    padding: "5px 9px",
                    borderRadius: 999,
                    border: `1px solid ${COLORS.border}`,
                    background: "#ffffff",
                    whiteSpace: "nowrap",
                    justifySelf: "end",
                  }}
                >
                  Denominated in {tokenSymbol ?? cfg.tokenLabel}
                </div>
              </div>
              {/* Locked row: label left, value right */}
              <div style={{ color: COLORS.subtext, fontWeight: 700 }}>
                Locked
              </div>
              <div style={{ fontWeight: 900 }}>{lockedMnee ?? "…"}</div>
            </div>

            <div
              style={{
                marginTop: 2,
                padding: 12,
                borderRadius: 12,
                border: `1px solid ${COLORS.border}`,
                background: "#eef2ff",
                display: "flex",
                gap: 10,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <div style={{ fontWeight: 900, color: "#1e3a8a" }}>
                Fund Mozi Treasury
              </div>

              <input
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                placeholder="Amount (e.g., 100)"
                style={{
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: `1px solid ${COLORS.border}`,
                  minWidth: 180,
                  outline: "none",
                  background: "#ffffff",
                  color: COLORS.text,
                  fontWeight: 700,
                  boxShadow: "inset 0 1px 2px rgba(0,0,0,0.04)",
                }}
              />

              <button
                onClick={depositToTreasury}
                disabled={
                  isDepositing ||
                  !address ||
                  !TREASURY_HUB_ADDRESS ||
                  !isCorrectChain
                }
                style={btnPrimary(
                  isDepositing ||
                    !address ||
                    !TREASURY_HUB_ADDRESS ||
                    !isCorrectChain
                )}
              >
                {isDepositing ? "Depositing…" : "Deposit to Treasury"}
              </button>

              {!address && (
                <div style={{ color: COLORS.subtext, fontWeight: 700 }}>
                  (Connect wallet first)
                </div>
              )}

              {address && !isCorrectChain && (
                <div style={{ color: COLORS.subtext, fontWeight: 700 }}>
                  (Switch to {cfg.name} first)
                </div>
              )}
            </div>

            <div
              style={{
                marginTop: 10,
                padding: 12,
                borderRadius: 12,
                border: `1px solid ${COLORS.border}`,
                background: "#fefce8",
                display: "flex",
                gap: 10,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <div style={{ fontWeight: 900, color: "#92400e" }}>Withdraw</div>

              <input
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                placeholder="Amount (e.g., 100)"
                style={{
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: `1px solid ${COLORS.border}`,
                  minWidth: 180,
                  outline: "none",
                  background: "#ffffff",
                  color: COLORS.text,
                  fontWeight: 700,
                  boxShadow: "inset 0 1px 2px rgba(0,0,0,0.04)",
                }}
              />

              <button
                onClick={withdrawFromTreasury}
                disabled={
                  isWithdrawing ||
                  !address ||
                  !TREASURY_HUB_ADDRESS ||
                  !isCorrectChain
                }
                style={{
                  padding: "10px 14px",
                  borderRadius: 10,
                  background: COLORS.warning, // matches Withdraw section
                  color: COLORS.buttonTextLight,
                  border: "none",
                  fontWeight: 900,
                  cursor:
                    isWithdrawing ||
                    !address ||
                    !TREASURY_HUB_ADDRESS ||
                    !isCorrectChain
                      ? "not-allowed"
                      : "pointer",
                  opacity:
                    isWithdrawing ||
                    !address ||
                    !TREASURY_HUB_ADDRESS ||
                    !isCorrectChain
                      ? 0.65
                      : 1,
                }}
              >
                {isWithdrawing ? "Withdrawing…" : "Withdraw"}
              </button>

              <button
                onClick={async () => {
                  if (!hasProvider || !address) return;
                  if (!isCorrectChain) {
                    setError(`Switch to ${cfg.name} to withdraw.`);
                    return;
                  }
                  if (!TREASURY_HUB_ADDRESS) {
                    setError(
                      "Missing NEXT_PUBLIC_MOZI_TREASURY_HUB_ADDRESS in .env.local"
                    );
                    return;
                  }

                  try {
                    setError(null);
                    setIsWithdrawing(true);

                    const ethereum = (window as any).ethereum;
                    const provider = new BrowserProvider(ethereum);
                    const signer = await provider.getSigner();

                    const hub = new Contract(
                      TREASURY_HUB_ADDRESS,
                      TREASURY_HUB_ABI,
                      signer
                    );
                    const tx = await (hub as any).withdrawAvailable();
                    await tx.wait();

                    await refreshBalances();
                  } catch (e: any) {
                    if (!shouldSuppressWalletError(e)) {
                      setError(e?.message ?? String(e));
                    }
                  } finally {
                    setIsWithdrawing(false);
                  }
                }}
                disabled={
                  isWithdrawing ||
                  !address ||
                  !TREASURY_HUB_ADDRESS ||
                  !isCorrectChain
                }
                style={{
                  padding: "10px 14px",
                  borderRadius: 10,
                  background: "#92400e", // dark amber fill
                  color: "#ffffff", // white text
                  border: "none",
                  fontWeight: 900,
                  cursor:
                    isWithdrawing ||
                    !address ||
                    !TREASURY_HUB_ADDRESS ||
                    !isCorrectChain
                      ? "not-allowed"
                      : "pointer",
                  opacity:
                    isWithdrawing ||
                    !address ||
                    !TREASURY_HUB_ADDRESS ||
                    !isCorrectChain
                      ? 0.65
                      : 1,
                }}
              >
                Withdraw Available
              </button>
            </div>
          </section>
        )}

        {/* Wallet */}
        <section style={cardStyle}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              alignItems: "center",
            }}
          >
            <div>
              <div style={{ fontWeight: 900 }}>Wallet</div>
              <div style={{ marginTop: 4, color: COLORS.subtext }}>
                {address ? "Connected" : "Not connected"}
              </div>
            </div>

            {!address ? (
              <button
                onClick={connect}
                disabled={isConnecting}
                style={btnPrimary(isConnecting)}
              >
                {isConnecting ? "Connecting…" : "Connect Wallet"}
              </button>
            ) : (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  onClick={refreshBalances}
                  disabled={isRefreshing}
                  style={btnRefreshNeutral(isRefreshing)}
                >
                  {isRefreshing ? "Refreshing…" : "Refresh"}
                </button>

                <button
                  onClick={logout}
                  disabled={isSwitchingNetwork}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 10,
                    background: COLORS.danger,
                    color: COLORS.buttonTextLight,
                    border: "none",
                    fontWeight: 900,
                    cursor: isSwitchingNetwork ? "not-allowed" : "pointer",
                    opacity: isSwitchingNetwork ? 0.65 : 1,
                  }}
                >
                  Logout
                </button>
              </div>
            )}
          </div>

          {walletReady && !hasProvider && (
            <div
              style={{
                color: "#92400e",
                background: "#fffbeb",
                border: "1px solid #fde68a",
                padding: 10,
                borderRadius: 12,
                fontWeight: 700,
              }}
            >
              No injected wallet detected. Install MetaMask to connect.
            </div>
          )}

          {address && (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "160px 1fr",
                  rowGap: 8,
                  columnGap: 12,
                  padding: 12,
                  borderRadius: 12,
                  border: `1px solid ${COLORS.border}`,
                  background: "#fbfdff",
                }}
              >
                <div style={{ color: COLORS.subtext, fontWeight: 700 }}>
                  Address
                </div>
                <div
                  style={{
                    fontFamily: "ui-monospace, Menlo, monospace",
                    fontWeight: 800,
                  }}
                >
                  {address}
                </div>

                <div style={{ color: COLORS.subtext, fontWeight: 700 }}>
                  Network
                </div>
                <div
                  style={{
                    fontFamily: "ui-monospace, Menlo, monospace",
                    fontWeight: 800,
                  }}
                >
                  {chainLabel(chainIdHex)}
                </div>

                <div style={{ color: COLORS.subtext, fontWeight: 700 }}>
                  {env === "testing" ? "Sepolia ETH" : "ETH"}
                </div>
                <div style={{ fontWeight: 900 }}>{ethBalance ?? "…"}</div>

                <div style={{ color: COLORS.subtext, fontWeight: 700 }}>
                  {tokenSymbol ?? cfg.tokenLabel}
                </div>
                <div style={{ fontWeight: 900 }}>{tokenBalance ?? "…"}</div>
              </div>

              {!isCorrectChain && showSwitchNetwork && (
                <div
                  style={{
                    color: "#92400e",
                    background: "#fffbeb",
                    border: "1px solid #fde68a",
                    padding: 10,
                    borderRadius: 12,
                    fontWeight: 700,
                  }}
                >
                  Wrong network for <b>{cfg.name}</b>. Use “Switch Network”.
                </div>
              )}

              {/* Mint (Testing only) */}
              {env === "testing" && (
                <div
                  style={{
                    marginTop: 2,
                    padding: 12,
                    borderRadius: 12,
                    border: `1px solid ${COLORS.border}`,
                    background: "#f0fdf4",
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ fontWeight: 900, color: "#065f46" }}>
                    Mint Mock
                  </div>

                  <input
                    value={mintAmount}
                    onChange={(e) => setMintAmount(e.target.value)}
                    placeholder="Amount (e.g., 1000)"
                    style={{
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: `1px solid ${COLORS.border}`,
                      minWidth: 180,
                      outline: "none",

                      background: "#ffffff",
                      color: COLORS.text,
                      fontWeight: 700,

                      boxShadow: "inset 0 1px 2px rgba(0,0,0,0.04)",
                    }}
                  />

                  <button
                    onClick={mintMock}
                    disabled={isMinting || !isCorrectChain}
                    style={{
                      padding: "10px 14px",
                      borderRadius: 10,
                      background: COLORS.secondary,
                      color: COLORS.buttonTextLight,
                      border: "none",
                      fontWeight: 900,
                      cursor:
                        isMinting || !isCorrectChain
                          ? "not-allowed"
                          : "pointer",
                      opacity: isMinting || !isCorrectChain ? 0.65 : 1,
                    }}
                  >
                    {isMinting ? "Minting…" : "Mint mMNEE"}
                  </button>

                  {!isCorrectChain && (
                    <div style={{ color: COLORS.subtext, fontWeight: 700 }}>
                      (Switch to Sepolia to mint)
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {error && (
            <div
              style={{
                color: "#991b1b",
                background: "#fef2f2",
                border: "1px solid #fecaca",
                padding: 10,
                borderRadius: 12,
                fontWeight: 700,
              }}
            >
              {error}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
