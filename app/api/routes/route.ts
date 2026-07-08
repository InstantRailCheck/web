import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRouteIntelligence } from "@/lib/routingEngine";
import { apiJson, apiError, apiCorsPreflight, legacyApiRedirect } from "@/lib/apiResponse";
import { getClientIp, isRateLimited } from "@/lib/rateLimit";

export function OPTIONS() {
  return apiCorsPreflight();
}

export async function GET(request: NextRequest) {
  const redirect = legacyApiRedirect(request);
  if (redirect) return redirect;

  if (await isRateLimited(getClientIp(request))) {
    return apiError("Rate limit exceeded. Try again shortly.", 429);
  }

  const from = request.nextUrl.searchParams.get("from");
  const to = request.nextUrl.searchParams.get("to");

  if (!from || !to) {
    return apiError("Both 'from' and 'to' bank id query params are required", 400);
  }

  const supabase = await createClient();
  const result = await getRouteIntelligence(from, to, supabase);

  return apiJson(result);
}
