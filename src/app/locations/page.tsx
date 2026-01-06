// src/app/locations/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const COLORS = {
  text: "#0f172a",
  subtext: "#64748b",
  card: "#ffffff",
  border: "#e5e7eb",

  primary: "#2563eb",
  primaryHover: "#1d4ed8",
  buttonTextLight: "#ffffff",
};

type LocationSummary = {
  id: string;
  name: string;
  timezone: string;
};

function shortenId(id: string) {
  if (!id) return "—";
  return id.length <= 10 ? id : `${id.slice(0, 6)}…${id.slice(-4)}`;
}

export default function LocationsPage() {
  const [locations, setLocations] = useState<LocationSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const cardStyle: React.CSSProperties = useMemo(
    () => ({
      marginTop: 16,
      padding: 16,
      background: COLORS.card,
      border: `1px solid ${COLORS.border}`,
      borderRadius: 14,
      boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
      display: "flex",
      flexDirection: "column",
      gap: 12,
    }),
    []
  );

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch("/api/locations");
        const data = await res.json();
        if (!res.ok) throw new Error(JSON.stringify(data, null, 2));

        setLocations((data.locations ?? []) as LocationSummary[]);
      } catch (e: any) {
        setError(String(e?.message ?? e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

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
          <div>
            <Link
              href="/"
              style={{
                textDecoration: "none",
                color: COLORS.text,
                fontWeight: 900,
                padding: "8px 10px",
                borderRadius: 12,
                border: `1px solid ${COLORS.border}`,
                background: "rgba(255,255,255,0.65)",
                boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                display: "inline-block",
              }}
            >
              ← Home
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
            Locations
          </h1>

          <div style={{ display: "flex", justifyContent: "flex-end" }} />
        </header>

        {/* Status / Error */}
        {error ? (
          <section
            style={{
              marginTop: 16,
              padding: 14,
              borderRadius: 14,
              border: "1px solid #fecaca",
              background: "#fef2f2",
              color: "#991b1b",
              fontWeight: 800,
              whiteSpace: "pre-wrap",
            }}
          >
            {error}
          </section>
        ) : (
          <>
            {/* List container */}
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
                <div style={{ fontWeight: 950 }}>Your locations</div>
                <div style={{ color: COLORS.subtext, fontWeight: 800 }}>
                  {loading
                    ? "Loading…"
                    : `${locations.length} location${
                        locations.length === 1 ? "" : "s"
                      }`}
                </div>
              </div>

              {/* Empty / Loading */}
              {loading ? (
                <div style={{ color: COLORS.subtext, fontWeight: 700 }}>
                  Fetching locations…
                </div>
              ) : locations.length === 0 ? (
                <div style={{ color: COLORS.subtext, fontWeight: 700 }}>
                  No locations returned.
                </div>
              ) : (
                <div style={{ display: "grid", gap: 12 }}>
                  {locations.map((loc) => (
                    <Link
                      key={loc.id}
                      href={`/locations/${loc.id}`}
                      style={{
                        padding: 16,
                        borderRadius: 14,
                        border: `1px solid ${COLORS.border}`,
                        background: "rgba(255,255,255,0.75)",
                        textDecoration: "none",
                        color: "inherit",
                        display: "block",
                        boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
                        transition:
                          "transform 120ms ease, box-shadow 120ms ease",
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLAnchorElement).style.transform =
                          "translateY(-1px)";
                        (e.currentTarget as HTMLAnchorElement).style.boxShadow =
                          "0 6px 18px rgba(0,0,0,0.08)";
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLAnchorElement).style.transform =
                          "translateY(0px)";
                        (e.currentTarget as HTMLAnchorElement).style.boxShadow =
                          "0 1px 2px rgba(0,0,0,0.04)";
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
                        <div style={{ fontWeight: 950, fontSize: 16 }}>
                          {loc.name}
                        </div>

                        <div
                          style={{
                            fontFamily: "ui-monospace, Menlo, monospace",
                            fontWeight: 900,
                            color: COLORS.subtext,
                            background: "rgba(255,255,255,0.6)",
                            border: `1px solid ${COLORS.border}`,
                            padding: "6px 10px",
                            borderRadius: 999,
                          }}
                          title={loc.id}
                        >
                          {shortenId(loc.id)}
                        </div>
                      </div>

                      <div
                        style={{
                          marginTop: 6,
                          color: COLORS.subtext,
                          fontWeight: 700,
                        }}
                      >
                        Timezone: {loc.timezone}
                      </div>

                      <div
                        style={{
                          marginTop: 10,
                          display: "flex",
                          justifyContent: "flex-end",
                        }}
                      >
                        <span
                          style={{
                            background: "#eff6ff",
                            border: "1px solid #bfdbfe",
                            color: "#1d4ed8",
                            padding: "8px 12px",
                            borderRadius: 12,
                            fontWeight: 950,
                          }}
                        >
                          Open →
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </section>

            {/* Small footer hint */}
            {!error && (
              <div
                style={{
                  marginTop: 14,
                  color: "rgba(15,23,42,0.6)",
                  fontWeight: 700,
                  textAlign: "center",
                }}
              >
                Select a location to view inventory and purchasing activity.
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
