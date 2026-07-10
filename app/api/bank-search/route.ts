import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { apiJson, apiError } from "@/lib/apiResponse";
import { isRateLimited, getClientIp } from "@/lib/rateLimit";

// Backs the BankSelect dropdown's live search — not part of the documented
// public API (that's /api/banks). Kept separate so a burst of on-page
// typing never contends with the public API's own rate limit budget.
const RESULTS_LIMIT = 50;

export async function GET(request: NextRequest) {
  if (await isRateLimited(getClientIp(request))) {
    return apiError("Rate limit exceeded. Try again shortly.", 429);
  }

  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  const supabase = await createClient();

  let query = supabase
    .from("banks")
    .select("id, slug, name")
    .order("name", { ascending: true })
    .limit(RESULTS_LIMIT);

  if (q) query = query.ilike("name", `%${q}%`);

  const { data, error } = await query;
  if (error) return apiError(error.message, 500);

  return apiJson({ banks: data ?? [] });
}
