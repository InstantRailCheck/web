import { createAdminClient } from "@/lib/supabase/admin";
import type { NextRequest } from "next/server";

const WINDOW_SECONDS = 60;
const LIMIT = 60;

export function getClientIp(request: NextRequest): string {
  // Cloudflare sits in front of Vercel and appends to (rather than replaces)
  // X-Forwarded-For, so a client-supplied first hop there can't be trusted —
  // it could be spoofed to cycle through fake IPs and bypass rate limiting.
  // CF-Connecting-IP is set by Cloudflare from the actual connection and any
  // client-supplied copy of it is stripped before we ever see it.
  const cfIp = request.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp.trim();
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return "unknown";
}

export async function isRateLimited(identifier: string): Promise<boolean> {
  const supabase = createAdminClient();
  const windowStart = Math.floor(Date.now() / 1000 / WINDOW_SECONDS);

  const { data, error } = await supabase.rpc("increment_rate_limit", {
    p_key: identifier,
    p_window: windowStart,
  });

  if (error) return false; // fail open — don't block real traffic if the limiter itself errors

  return (data as number) > LIMIT;
}
