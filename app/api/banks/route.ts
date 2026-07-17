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
// DEFAULT_UNPAGINATED_CAP is a hard safety net for the *unspecified* case.
//
// Measured, not guessed (app/api/banks/route.test.ts): 10,000 rows with
// every field realistically populated (a representative row, not a
// contrived worst case) serializes to ~4.4MB — dangerously close to
// Vercel's real 4.5MB function response limit on its own, before any
// other response overhead. 5,000 keeps the unpaginated response at
// roughly half that measured density (~2.2MB), leaving real headroom
// rather than hugging the ceiling. This does NOT comfortably cover the
// completed ~8,500-institution directory unpaginated in the worst case —
// that's intentional: a response this large truncates (truncated=true,
// next_offset set) rather than risk exceeding the platform's hard limit,
// and a consumer that needs the rest already has explicit pagination to
// get it.
const MAX_LIMIT = 500;
const DEFAULT_UNPAGINATED_CAP = 5000;
const MAX_QUERY_LENGTH = 200;

export const GET = withApiProtection(async (request: NextRequest) => {
  const q = request.nextUrl.searchParams.get("q")?.slice(0, MAX_QUERY_LENGTH) || null;
  const format = request.nextUrl.searchParams.get("format");
  const limitParam = request.nextUrl.searchParams.get("limit");
  const offsetParam = request.nextUrl.searchParams.get("offset");
  const includeInactive = request.nextUrl.searchParams.get("include_inactive") === "true";

  const limit = limitParam ? Math.min(Math.max(Number(limitParam) || 1, 1), MAX_LIMIT) : DEFAULT_UNPAGINATED_CAP;
  const offset = Math.max(Number(offsetParam) || 0, 0);

  const supabase = await createClient();
  let query = supabase
    .from("banks")
    .select(
      "id, slug, name, website, address, phone, city, state, aka_names, fednow_participant, rtp_participant, zelle_participant",
      { count: "exact" }
    )
    .order("name")
    .order("id")
    .range(offset, offset + limit - 1);

  if (!includeInactive) {
    query = query.eq("is_active", true);
  }

  if (q) {
    query = query.ilike("name_normalized", `%${normalizeForSearch(q)}%`);
  }

  const { data, error, count } = await query;
  if (error) return apiJson({ error: error.message }, { status: 500 });

  const total = count ?? 0;
  const returned = data?.length ?? 0;
  const truncated = offset + returned < total;
  const nextOffset = truncated ? offset + returned : null;

  if (format === "csv") {
    return apiCsv(toCsv(data ?? []), "banks.csv", {
      "X-Total-Count": String(total),
      "X-Truncated": String(truncated),
      "X-Next-Offset": nextOffset === null ? "" : String(nextOffset),
    });
  }

  return apiJson({ banks: data, total, limit, offset, truncated, next_offset: nextOffset });
});
