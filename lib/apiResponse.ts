import { NextRequest, NextResponse } from "next/server";
import { API_URL } from "@/lib/siteConfig";
import { getClientIp, isRateLimited } from "@/lib/rateLimit";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  // Belt-and-suspenders alongside robots.txt: this applies regardless of
  // which hostname/path served the response, and works even against bots
  // that don't bother respecting robots.txt.
  "X-Robots-Tag": "noindex",
};

export function apiJson(data: unknown, init?: { status?: number }) {
  return NextResponse.json(data, {
    status: init?.status ?? 200,
    headers: CORS_HEADERS,
  });
}

export function apiError(message: string, status: number) {
  return apiJson({ error: message }, { status });
}

export function apiCsv(csv: string, filename: string) {
  return new NextResponse(csv, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

// A CORS preflight (OPTIONS) request must always get a direct answer, never
// a redirect — some browsers refuse to follow a redirected preflight even
// when the real request would have worked fine. Only legacyApiRedirect (the
// actual GET/data request) redirects; this never does.
export function apiCorsPreflight() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
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

    if (await isRateLimited(getClientIp(request))) {
      return apiError("Rate limit exceeded. Try again shortly.", 429);
    }

    return handler(request, ...args);
  };
}
