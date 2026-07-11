import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { apiJson, apiCsv, apiCorsPreflight, withApiProtection } from "@/lib/apiResponse";
import { toCsv } from "@/lib/csv";
import { normalizeForSearch } from "@/lib/utils";

export function OPTIONS() {
  return apiCorsPreflight();
}

// ?limit=/?offset= are optional — omitting them keeps the documented
// "list all banks" behavior consumers already rely on, no breaking change
// or X-Api-Version bump needed. MAX_LIMIT bounds an explicit request;
// DEFAULT_UNPAGINATED_CAP is a hard safety net for the *unspecified* case,
// generous enough to comfortably cover the current ~4,671-bank directory
// while still bounding a pathological response if that count ever grows
// far beyond today's scale.
const MAX_LIMIT = 500;
const DEFAULT_UNPAGINATED_CAP = 5000;
const MAX_QUERY_LENGTH = 200;

export const GET = withApiProtection(async (request: NextRequest) => {
  const q = request.nextUrl.searchParams.get("q")?.slice(0, MAX_QUERY_LENGTH) || null;
  const format = request.nextUrl.searchParams.get("format");
  const limitParam = request.nextUrl.searchParams.get("limit");
  const offsetParam = request.nextUrl.searchParams.get("offset");

  const limit = limitParam ? Math.min(Math.max(Number(limitParam) || 1, 1), MAX_LIMIT) : DEFAULT_UNPAGINATED_CAP;
  const offset = Math.max(Number(offsetParam) || 0, 0);

  const supabase = await createClient();
  let query = supabase
    .from("banks")
    .select("id, slug, name, website, address, phone, fednow_participant, rtp_participant, zelle_participant", {
      count: "exact",
    })
    .order("name")
    .range(offset, offset + limit - 1);

  if (q) {
    query = query.ilike("name_normalized", `%${normalizeForSearch(q)}%`);
  }

  const { data, error, count } = await query;
  if (error) return apiJson({ error: error.message }, { status: 500 });

  if (format === "csv") {
    return apiCsv(toCsv(data ?? []), "banks.csv");
  }

  return apiJson({ banks: data, total: count ?? 0, limit, offset });
});
