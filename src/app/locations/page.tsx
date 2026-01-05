// src/app/locations/page.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type LocationSummary = {
  id: string;
  name: string;
  timezone: string;
};

export default function LocationsPage() {
  const [locations, setLocations] = useState<LocationSummary[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/locations");
        const data = await res.json();
        if (!res.ok) throw new Error(JSON.stringify(data, null, 2));
        setLocations((data.locations ?? []) as LocationSummary[]);
      } catch (e: any) {
        setError(String(e?.message ?? e));
      }
    })();
  }, []);

  return (
    <main style={{ padding: 24, fontFamily: "system-ui", maxWidth: 900 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <Link href="/" style={{ textDecoration: "none" }}>
          ← Home
        </Link>
      </div>

      <h1 style={{ fontSize: 26, fontWeight: 800, marginTop: 10 }}>
        Locations
      </h1>

      {error ? (
        <pre
          style={{
            marginTop: 16,
            padding: 16,
            borderRadius: 12,
            border: "1px solid #f3c",
            whiteSpace: "pre-wrap",
          }}
        >
          {error}
        </pre>
      ) : (
        <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
          {locations.map((loc) => (
            <Link
              key={loc.id}
              href={`/locations/${loc.id}`}
              style={{
                padding: 16,
                borderRadius: 12,
                border: "1px solid #eee",
                textDecoration: "none",
                color: "inherit",
                display: "block",
              }}
            >
              <div style={{ fontWeight: 800 }}>{loc.name}</div>
              <div style={{ marginTop: 4, color: "#555" }}>
                ID: {loc.id} • TZ: {loc.timezone}
              </div>
            </Link>
          ))}

          {!locations.length ? (
            <div style={{ color: "#555" }}>No locations returned.</div>
          ) : null}
        </div>
      )}
    </main>
  );
}
