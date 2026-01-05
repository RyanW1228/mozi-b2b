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
  // Hard fail if any location is missing an id (prevents silent undefined routing)
  for (const loc of LOCATIONS) {
    if (!loc.id || typeof loc.id !== "string") {
      return NextResponse.json(
        { error: "Invalid location: missing id", badLocation: loc },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ locations: LOCATIONS });
}
