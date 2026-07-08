import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { apiJson, apiError } from "@/lib/apiResponse";
import { getClientIp, isRateLimited } from "@/lib/rateLimit";

export async function GET(request: NextRequest) {
  if (await isRateLimited(getClientIp(request))) {
    return apiError("Rate limit exceeded. Try again shortly.", 429);
  }

  const q = request.nextUrl.searchParams.get("q");

  const supabase = await createClient();
  let query = supabase
    .from("banks")
    .select("id, name, website, address, phone, fednow_participant, rtp_participant, zelle_participant")
    .order("name");

  if (q) {
    query = query.ilike("name", `%${q}%`);
  }

  const { data, error } = await query;
  if (error) return apiJson({ error: error.message }, { status: 500 });

  return apiJson({ banks: data });
}
