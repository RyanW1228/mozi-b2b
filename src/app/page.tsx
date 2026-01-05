// src/app/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  BrowserProvider,
  Contract,
  formatEther,
  formatUnits,
  parseUnits,
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

  const cfg = env === "testing" ? TESTING : PRODUCTION;

  const isCorrectChain =
    !!chainIdHex && chainIdHex.toLowerCase() === cfg.chainIdHex.toLowerCase();

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

  const pill = (bg: string, active: boolean): React.CSSProperties => ({
    padding: "10px 14px",
    borderRadius: 10,
    background: active ? bg : "#ffffff",
    color: active ? COLORS.buttonTextLight : COLORS.text,
    border: active ? "none" : `1px solid ${COLORS.border}`,
    fontWeight: 900,
    cursor: "pointer",
  });

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
        // If user cancels the permissions prompt, stop cleanly.
        setError(permErr?.message ?? "Wallet connection canceled.");
        return;
      }

      const accounts: string[] = await ethereum.request({
        method: "eth_requestAccounts",
      });

      const a = accounts?.[0] ?? null;
      const c: string = await ethereum.request({ method: "eth_chainId" });

      setAddress(a);
      setChainIdHex(c);

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

      const [decimals, symbol, raw] = await Promise.all([
        token.decimals() as Promise<number>,
        token.symbol() as Promise<string>,
        token.balanceOf(address) as Promise<bigint>,
      ]);

      setTokenSymbol(symbol || cfg.tokenLabel);
      setTokenBalance(trimTo6Decimals(formatUnits(raw, decimals)));
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
      setError(e?.message ?? String(e));
    } finally {
      setIsMinting(false);
    }
  }

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
      if (next) refreshBalances();
      setEthBalance(null);
      setTokenBalance(null);
      setTokenSymbol(null);
      setError(null);
    };

    const onChainChanged = (c: string) => {
      setChainIdHex(c);
      setEthBalance(null);
      setTokenBalance(null);
      setTokenSymbol(null);
      setError(null);

      // Don’t flash the button; refresh immediately.
      setShowSwitchNetwork(false);

      // Refresh balances for the new chain
      // (safe: refreshBalances checks address/hasProvider)
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
              href="/locations"
              style={{
                padding: "10px 16px",
                borderRadius: 12,

                background: "#eff6ff", // soft blue tint
                border: "1px solid #bfdbfe", // light blue border
                color: "#1d4ed8", // readable blue text

                textDecoration: "none",
                fontWeight: 900,
              }}
            >
              Locations
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

          {env === "production" && (
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
              Production points to mainnet. Treat any future write actions as
              real-value transactions.
            </div>
          )}
        </section>

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
                  style={{
                    padding: "10px 14px",
                    borderRadius: 10,

                    background: "#f8fafc", // light neutral
                    border: `1px solid ${COLORS.border}`,
                    color: COLORS.text,

                    fontWeight: 800,
                    cursor: isRefreshing ? "not-allowed" : "pointer",
                    opacity: isRefreshing ? 0.6 : 1,
                  }}
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
                  {shorten(address)}
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
                  ETH
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
