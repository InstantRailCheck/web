import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { apiJson, apiError, apiCsv, apiCorsPreflight, legacyApiRedirect } from "@/lib/apiResponse";
import { getClientIp, isRateLimited } from "@/lib/rateLimit";
import { toCsv } from "@/lib/csv";

export function OPTIONS() {
  return apiCorsPreflight();
}

export async function GET(request: NextRequest) {
  const redirect = legacyApiRedirect(request);
  if (redirect) return redirect;

  if (await isRateLimited(getClientIp(request))) {
    return apiError("Rate limit exceeded. Try again shortly.", 429);
  }

  const q = request.nextUrl.searchParams.get("q");
  const format = request.nextUrl.searchParams.get("format");

  const supabase = await createClient();
  let query = supabase
    .from("banks")
    .select("id, slug, name, website, address, phone, fednow_participant, rtp_participant, zelle_participant")
    .order("name");

  if (q) {
    query = query.ilike("name", `%${q}%`);
  }

  const { data, error } = await query;
  if (error) return apiJson({ error: error.message }, { status: 500 });

  if (format === "csv") {
    return apiCsv(toCsv(data ?? []), "banks.csv");
  }

  return apiJson({ banks: data });
}
