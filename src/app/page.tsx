// src/app/page.tsx
"use client";

import Link from "next/link";

export default function Home() {
  return (
    <main style={{ padding: 24, fontFamily: "system-ui", maxWidth: 900 }}>
      <h1 style={{ fontSize: 28, fontWeight: 800 }}>Mozi</h1>
      <p style={{ marginTop: 8, color: "#555" }}>
        Autonomous purchasing agent for inventory-based businesses.
      </p>

      <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
        <Link
          href="/locations"
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid #ddd",
            textDecoration: "none",
            color: "inherit",
            fontWeight: 600,
          }}
        >
          Locations
        </Link>
      </div>

      <div style={{ marginTop: 16, color: "#777" }}>
        (Next: recent plans, pending intents, alerts)
      </div>
    </main>
  );
}
