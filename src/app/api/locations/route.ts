// src/app/api/locations/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";

export type LocationSummary = {
  id: string;
  name: string;
  timezone: string;
};

const LOCATIONS: LocationSummary[] = [
  { id: "loc-1", name: "Downtown", timezone: "America/New_York" },
  { id: "loc-2", name: "Uptown", timezone: "America/New_York" },
];

export async function GET() {
  return NextResponse.json({ locations: LOCATIONS });
}
