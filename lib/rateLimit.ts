import { createAdminClient } from "@/lib/supabase/admin";
import { headers } from "next/headers";
import type { NextRequest } from "next/server";

const WINDOW_SECONDS = 60;
const LIMIT = 60;

// Verified directly against production (2026-07-11): the site is served
// straight from Vercel with no Cloudflare in front (no CF-Ray/Cloudflare
// Server header on any response; DNS resolves to Vercel's own network) — a
// header like CF-Connecting-IP is NOT set by any trusted intermediary here
// and must never be trusted, since anyone can send it directly.
//
// Per Vercel's own docs, it overwrites X-Forwarded-For for external clients
// and does not forward a spoofed value (Enterprise-only "Trusted Proxy"
// opt-in aside, which isn't configured for this project) —
// x-vercel-forwarded-for is Vercel's most authoritative copy of the same
// value, guaranteed not overwritten even if a trusted proxy is ever added in
// front of Vercel later, so it's checked first with plain x-forwarded-for as
// a fallback.
//
// If Cloudflare (or any other proxy) is ever actually put in front of
// Vercel, re-verify the deployment boundary before trusting any of its
// headers again — don't just restore the old CF-Connecting-IP check.
function extractClientIp(getHeader: (name: string) => string | null): string {
  const vercelForwarded = getHeader("x-vercel-forwarded-for");
  if (vercelForwarded) return vercelForwarded.split(",")[0].trim();
  const forwarded = getHeader("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return "unknown";
}

export function getClientIp(request: NextRequest): string {
  return extractClientIp((name) => request.headers.get(name));
}

// Server Actions have no NextRequest to read — next/headers' headers() is
// the equivalent read-only view of the incoming request for that context.
export async function getClientIpFromServerAction(): Promise<string> {
  const h = await headers();
  return extractClientIp((name) => h.get(name));
}

export async function isRateLimited(
  identifier: string,
  limit: number = LIMIT,
  windowSeconds: number = WINDOW_SECONDS
): Promise<boolean> {
  const supabase = createAdminClient();
  const windowStart = Math.floor(Date.now() / 1000 / windowSeconds);

  const { data, error } = await supabase.rpc("increment_rate_limit", {
    p_key: identifier,
    p_window: windowStart,
  });

  if (error) return false; // fail open — don't block real traffic if the limiter itself errors

  return (data as number) > limit;
}

// Server Actions (addBank, submitCorrection, registerWebhook) are all
// authenticated, so user ID is the primary throttling key — but a single
// account isn't the only abuse shape (a script could create many accounts
// from one IP), so IP is checked as a secondary signal per-call. Either
// tripping is enough to block the call.
export async function isActionRateLimited(
  actionName: string,
  userId: string,
  options: { userLimit: number; ipLimit: number; windowSeconds: number }
): Promise<boolean> {
  const ip = await getClientIpFromServerAction();
  const [userLimited, ipLimited] = await Promise.all([
    isRateLimited(`action:${actionName}:user:${userId}`, options.userLimit, options.windowSeconds),
    isRateLimited(`action:${actionName}:ip:${ip}`, options.ipLimit, options.windowSeconds),
  ]);
  return userLimited || ipLimited;
}
