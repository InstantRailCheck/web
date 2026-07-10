import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { apiJson, apiCsv, apiCorsPreflight, withApiProtection } from "@/lib/apiResponse";
import { toCsv } from "@/lib/csv";
import { normalizeForSearch } from "@/lib/utils";

export function OPTIONS() {
  return apiCorsPreflight();
}

export const GET = withApiProtection(async (request: NextRequest) => {
  const q = request.nextUrl.searchParams.get("q");
  const format = request.nextUrl.searchParams.get("format");

  const supabase = await createClient();
  let query = supabase
    .from("banks")
    .select("id, slug, name, website, address, phone, fednow_participant, rtp_participant, zelle_participant")
    .order("name");

  if (q) {
    query = query.ilike("name_normalized", `%${normalizeForSearch(q)}%`);
  }

  const { data, error } = await query;
  if (error) return apiJson({ error: error.message }, { status: 500 });

  if (format === "csv") {
    return apiCsv(toCsv(data ?? []), "banks.csv");
  }

  return apiJson({ banks: data });
});
