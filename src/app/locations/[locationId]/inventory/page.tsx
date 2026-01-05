// src/app/locations/[locationId]/inventory/page.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type InventoryRow = {
  sku: string;
  onHandUnits: number;
};

export default function InventoryPage({
  params,
}: {
  params: { locationId: string };
}) {
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  async function refresh() {
    setLoading(true);
    setMsg("");
    try {
      const res = await fetch(
        `/api/inventory?locationId=${encodeURIComponent(params.locationId)}`
      );
      const data = (await res.json()) as InventoryRow[];
      if (!res.ok) {
        setMsg(JSON.stringify(data, null, 2));
        setRows([]);
        return;
      }
      setRows(data);
    } catch (e: any) {
      setMsg(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function saveRow(sku: string, onHandUnits: number) {
    setMsg("");
    const res = await fetch(
      `/api/inventory?locationId=${encodeURIComponent(params.locationId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku, onHandUnits }),
      }
    );

    const data = await res.json();
    if (!res.ok) setMsg(JSON.stringify(data, null, 2));
    else setMsg(`Saved ${sku} for ${params.locationId}`);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.locationId]);

  return (
    <main style={{ padding: 24, fontFamily: "system-ui", maxWidth: 900 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700 }}>
        Inventory • {params.locationId}
      </h1>

      <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
        <Link
          href={`/locations/${params.locationId}`}
          style={{
            padding: "8px 12px",
            borderRadius: 10,
            border: "1px solid #ddd",
            textDecoration: "none",
            color: "inherit",
            display: "inline-block",
            fontWeight: 600,
          }}
        >
          ← Back to Purchase Plan
        </Link>

        <Link
          href="/locations"
          style={{
            padding: "8px 12px",
            borderRadius: 10,
            border: "1px solid #ddd",
            textDecoration: "none",
            color: "inherit",
            display: "inline-block",
            fontWeight: 600,
          }}
        >
          Locations
        </Link>
      </div>

      <div style={{ marginTop: 12 }}>
        <button
          onClick={refresh}
          disabled={loading}
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid #ddd",
          }}
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
        {msg && <div style={{ marginTop: 8 }}>{msg}</div>}
      </div>

      <table
        style={{
          marginTop: 16,
          width: "100%",
          borderCollapse: "collapse",
        }}
      >
        <thead>
          <tr>
            <th style={{ textAlign: "left", padding: 8 }}>SKU</th>
            <th style={{ textAlign: "right", padding: 8 }}>On Hand</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.sku}>
              <td style={{ padding: 8 }}>{r.sku}</td>
              <td style={{ padding: 8, textAlign: "right" }}>
                <input
                  type="number"
                  value={r.onHandUnits}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setRows((prev) =>
                      prev.map((x) =>
                        x.sku === r.sku ? { ...x, onHandUnits: v } : x
                      )
                    );
                  }}
                  style={{ width: 100 }}
                />
              </td>
              <td style={{ padding: 8 }}>
                <button onClick={() => saveRow(r.sku, r.onHandUnits)}>
                  Save
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
