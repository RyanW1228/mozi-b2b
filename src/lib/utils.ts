// Shared utility functions

export function shortenId(id: string): string {
  if (!id) return "—";
  return id.length <= 14 ? id : `${id.slice(0, 8)}…${id.slice(-4)}`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function fetchJsonWithTimeout(
  url: string,
  opts: RequestInit,
  timeoutMs: number
): Promise<{ res: Response; json: any }> {
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

export function sanitizeIntDraft(input: string): string {
  // digits only; allow empty while typing
  return input.replace(/[^\d]/g, "");
}

export function draftToClampedInt(
  draft: string,
  min: number,
  max: number
): number {
  if (!draft) return min; // if user leaves blank, snap to min
  const n = parseInt(draft, 10);
  if (!Number.isFinite(n) || Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export function pillStyle(colors: {
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

export function strategyLabel(
  s:
    | import("./types").RiskStrategy
    | string
    | null
    | undefined
): string {
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

