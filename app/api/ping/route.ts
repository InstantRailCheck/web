import { NextResponse } from "next/server";

// Zero-dependency liveness check — no database query, safe for a generic
// public uptime monitor to hit as often as it wants. /api/health is the
// deeper, token-gated check for actual data-freshness monitoring.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { status: "ok" },
    { headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" } }
  );
}
