import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { apiJson, apiError } from "@/lib/apiResponse";
import { isRateLimited, getClientIp, secondsUntilRateLimitReset } from "@/lib/rateLimit";
import { normalizeForSearch } from "@/lib/utils";
import { logError } from "@/lib/logger";

// Backs the BankSelect dropdown's live search — not part of the documented
// public API (that's /api/banks). Kept separate so a burst of on-page
// typing never contends with the public API's own rate limit budget: this
// uses its own "api:bank-search:" namespace rather than the bare IP that
// withApiProtection's "api:public:" namespace also derives from, so the two
// never share (or drain) the same underlying counter.
const RESULTS_LIMIT = 50;

export async function GET(request: NextRequest) {
  if (await isRateLimited(`api:bank-search:${getClientIp(request)}`)) {
    return apiError("Rate limit exceeded. Try again shortly.", 429, {
      "Retry-After": String(secondsUntilRateLimitReset()),
    });
  }

  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  const supabase = await createClient();

  // Public selectors only ever offer currently-listed institutions by
  // default — an inactive bank is still directly reachable by its own
  // profile URL (never 404s), just not discoverable through search/add.
  let query = supabase
    .from("banks")
    .select("id, slug, name, city, state")
    .eq("is_active", true)
    .order("name", { ascending: true })
    .order("id", { ascending: true })
    .limit(RESULTS_LIMIT);

  if (q) query = query.ilike("name_normalized", `%${normalizeForSearch(q)}%`);

  const { data, error } = await query;
  if (error) {
    logError("bank-search query failed", { error: error.message, q });
    return apiError("Something went wrong. Please try again.", 500);
  }

  return apiJson({ banks: data ?? [] });
}
