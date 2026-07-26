import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { apiJson, apiError, apiCsv, apiCorsPreflight, withApiProtection } from "@/lib/apiResponse";
import { toCsv } from "@/lib/csv";
import { normalizeForSearch } from "@/lib/utils";
import { logError } from "@/lib/logger";

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
const SUPPORTED_FORMATS = new Set(["json", "csv"]);
const SUPPORTED_BOOLEANS = new Set(["true", "false"]);

// Digits only — rejects negatives, decimals, "+5", "Infinity", "NaN",
// leading/trailing whitespace, and exponential notation outright, rather
// than coercing them into something plausible-looking the way `Number(x) ||
// fallback` did (e.g. "-5" silently became a clamped 1, "1.5" silently
// became a fractional Postgrest .range() bound).
const DIGITS_ONLY = /^\d+$/;

function parsePositiveInt(value: string): number | null {
  if (!DIGITS_ONLY.test(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 ? n : null;
}

function parseNonNegativeInt(value: string): number | null {
  if (!DIGITS_ONLY.test(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export const GET = withApiProtection(async (request: NextRequest) => {
  const q = request.nextUrl.searchParams.get("q")?.slice(0, MAX_QUERY_LENGTH) || null;
  const formatParam = request.nextUrl.searchParams.get("format");
  const limitParam = request.nextUrl.searchParams.get("limit");
  const offsetParam = request.nextUrl.searchParams.get("offset");
  const includeInactiveParam = request.nextUrl.searchParams.get("include_inactive");

  if (formatParam !== null && !SUPPORTED_FORMATS.has(formatParam)) {
    return apiError(`Invalid 'format': must be one of ${[...SUPPORTED_FORMATS].join(", ")}`, 400);
  }
  const format = formatParam;

  let limit = DEFAULT_UNPAGINATED_CAP;
  if (limitParam !== null) {
    const parsed = parsePositiveInt(limitParam);
    if (parsed === null || parsed > MAX_LIMIT) {
      return apiError(`Invalid 'limit': must be a positive integer up to ${MAX_LIMIT}`, 400);
    }
    limit = parsed;
  }

  let offset = 0;
  if (offsetParam !== null) {
    const parsed = parseNonNegativeInt(offsetParam);
    if (parsed === null) {
      return apiError("Invalid 'offset': must be a nonnegative integer", 400);
    }
    offset = parsed;
  }

  if (includeInactiveParam !== null && !SUPPORTED_BOOLEANS.has(includeInactiveParam)) {
    return apiError("Invalid 'include_inactive': must be 'true' or 'false'", 400);
  }
  const includeInactive = includeInactiveParam === "true";

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
  if (error) {
    logError("banks query failed", { error: error.message, q, limit, offset, includeInactive });
    return apiError("Something went wrong. Please try again.", 500);
  }

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
