import { NextRequest, NextResponse } from "next/server";
import { API_URL } from "@/lib/siteConfig";
import { getClientIp, isRateLimited, secondsUntilRateLimitReset } from "@/lib/rateLimit";

// Bumped on any breaking response-shape change to a documented endpoint (see
// app/developers/page.tsx) — e.g. v6 replaced /routes' confidence/successRate
// fields and /banks/:id's rail successRate with evidence-based fields. v7
// (v8.0): /banks defaults to active institutions only (?include_inactive=true
// opts back in), adds city/state to every row, and JSON/CSV responses gain
// pagination-parity fields (truncated/next_offset in JSON,
// X-Total-Count/X-Truncated/X-Next-Offset headers in CSV). v8: /banks/:id's
// eddEvidence.avgDaysEarly and eddEvidence.providers[].avgDaysEarly are now
// number | null instead of always number — null means every attributable
// reporter chose the open-ended "more than 5 days" option, so no numeric
// average exists (previously that sentinel was silently averaged in as a
// literal six, overstating the true average).
const API_VERSION = "8";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  // Belt-and-suspenders alongside robots.txt: this applies regardless of
  // which hostname/path served the response, and works even against bots
  // that don't bother respecting robots.txt.
  "X-Robots-Tag": "noindex",
  "X-Api-Version": API_VERSION,
};

// A conservative shared default across all four endpoints — short enough
// that /changelog (the most write-heavy one) never serves meaningfully
// stale activity, long enough to give CDNs/browsers real cache benefit
// for the slower-moving ones (/banks, /banks/:id, /routes). No endpoint
// varies by caller identity (no auth-scoped data), so a shared public
// cache is safe everywhere this header is applied to a successful response.
const PUBLIC_CACHE_CONTROL = "public, max-age=60, stale-while-revalidate=300";

// 4xx/429/5xx responses are per-request outcomes (a bad query param, an
// exhausted rate-limit window, a transient DB error), not shareable
// content — a shared/CDN cache holding onto one would keep serving it long
// after the underlying condition has cleared.
const ERROR_CACHE_CONTROL = "private, no-store";

export function apiJson(data: unknown, init?: { status?: number; headers?: Record<string, string> }) {
  const status = init?.status ?? 200;
  return NextResponse.json(data, {
    status,
    headers: {
      ...CORS_HEADERS,
      "Cache-Control": status >= 400 ? ERROR_CACHE_CONTROL : PUBLIC_CACHE_CONTROL,
      ...init?.headers,
    },
  });
}

export function apiError(message: string, status: number, headers?: Record<string, string>) {
  return apiJson({ error: message }, { status, headers });
}

export function apiCsv(csv: string, filename: string, extraHeaders?: Record<string, string>) {
  return new NextResponse(csv, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      "Cache-Control": PUBLIC_CACHE_CONTROL,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      ...extraHeaders,
    },
  });
}

// A CORS preflight (OPTIONS) request must always get a direct answer, never
// a redirect — some browsers refuse to follow a redirected preflight even
// when the real request would have worked fine. Only legacyApiRedirect (the
// actual GET/data request) redirects; this never does.
export function apiCorsPreflight() {
  return new NextResponse(null, { status: 204, headers: { ...CORS_HEADERS, "Cache-Control": PUBLIC_CACHE_CONTROL } });
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Every bank id in this schema is a Postgres-generated uuid column — a
// non-uuid value can never match a row, so rejecting it at the API boundary
// with a 400 (instead of letting it fall through to Postgres, which errors
// on invalid uuid input syntax) turns "malformed request" into the right
// status code instead of a raw DB error or a misleading empty result.
export function isValidUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

const LEGACY_API_HOSTS = new Set(["www.instantrailcheck.com", "instantrailcheck.com"]);

// Redirects a request that arrived via the legacy www.instantrailcheck.com/api/*
// path to the equivalent api.instantrailcheck.com/* path. Returns null for
// every other host (the subdomain itself, localhost, Vercel preview
// deployments) so those keep serving directly rather than redirecting.
export function legacyApiRedirect(request: NextRequest): NextResponse | null {
  const host = request.headers.get("host") ?? "";
  if (!LEGACY_API_HOSTS.has(host)) return null;

  const path = request.nextUrl.pathname.replace(/^\/api/, "");
  const target = new URL(`${API_URL}${path}${request.nextUrl.search}`);
  return NextResponse.redirect(target, 308);
}

// Wraps a GET handler with the legacy-redirect and rate-limit checks every
// API route needs, so a new route gets them by default instead of having
// to remember to call legacyApiRedirect/isRateLimited itself — previously
// each of the four route handlers duplicated this same boilerplate, which
// meant a route that forgot it would silently ship without protection.
export function withApiProtection<Args extends unknown[]>(
  handler: (request: NextRequest, ...args: Args) => Promise<NextResponse>
): (request: NextRequest, ...args: Args) => Promise<NextResponse> {
  return async (request: NextRequest, ...args: Args) => {
    const redirect = legacyApiRedirect(request);
    if (redirect) return redirect;

    // Namespaced so this documented-API budget can never be shared with (or
    // exhausted by) a different caller of isRateLimited keyed on the same
    // bare IP — see app/api/bank-search/route.ts's "api:bank-search:"
    // namespace for the other side of that split.
    if (await isRateLimited(`api:public:${getClientIp(request)}`)) {
      return apiError("Rate limit exceeded. Try again shortly.", 429, {
        "Retry-After": String(secondsUntilRateLimitReset()),
      });
    }

    return handler(request, ...args);
  };
}
