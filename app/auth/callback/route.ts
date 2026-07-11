import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { SITE_URL } from "@/lib/siteConfig";

// Only ever redirect back into this site after auth. Resolving against a
// fixed trusted origin (not request.url's own Host) and checking the
// *result's* origin — rather than pattern-matching the input string —
// defeats every open-redirect bypass class at once (absolute URLs,
// protocol-relative "//", backslash tricks the URL parser treats as "/",
// and control characters it silently strips before resolving), instead of
// only the specific ones anticipated up front.
export function sanitizeRedirectPath(next: string | null): string {
  if (!next) return "/";
  try {
    const resolved = new URL(next, SITE_URL);
    if (resolved.origin !== new URL(SITE_URL).origin) return "/";
    return resolved.pathname + resolved.search + resolved.hash;
  } catch {
    return "/";
  }
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = sanitizeRedirectPath(request.nextUrl.searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, request.url));
    }
  }

  return NextResponse.redirect(new URL("/?auth_error=1", request.url));
}
