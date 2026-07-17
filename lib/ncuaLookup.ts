import { createAdminClient } from "@/lib/supabase/admin";

export type NcuaMatch = {
  website: string | null;
  address: string | null;
  phone: string | null;
};

const SUFFIX_PATTERN = /\s+(federal credit union|credit union|fcu|cu)$/i;

// Unambiguous direct lookup for a bank whose ncua_charter_number is
// already known — used in place of lookupNcuaCreditUnion whenever a bank
// is already linked, so a name-based re-lookup can never resolve to a
// *different* charter sharing the same name.
export async function lookupNcuaCreditUnionByCharter(charter: number): Promise<NcuaMatch | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("ncua_credit_unions")
    .select("website, address, phone")
    .eq("charter_number", charter)
    .maybeSingle();

  return data ? toMatch(data) : null;
}

export async function lookupNcuaCreditUnion(name: string): Promise<NcuaMatch | null> {
  const stripped = name.trim().replace(SUFFIX_PATTERN, "").trim();
  const candidates = Array.from(new Set([name.trim(), stripped]));

  for (const candidate of candidates) {
    const match = await tryMatch(candidate);
    if (match) return match;
  }

  // Fall back to progressively shorter prefixes of the (suffix-stripped) name,
  // for cases like a product name tacked onto the credit union's own name.
  const words = stripped.split(/\s+/);
  const floor = Math.min(2, words.length);

  for (let i = words.length - 1; i >= floor; i--) {
    const match = await tryMatch(words.slice(0, i).join(" "));
    if (match) return match;
  }

  return null;
}

async function tryMatch(name: string): Promise<NcuaMatch | null> {
  const supabase = createAdminClient();
  const normalized = name.toLowerCase().trim();
  if (!normalized) return null;

  const { data: exact } = await supabase
    .from("ncua_credit_unions")
    .select("website, address, phone")
    .contains("search_names", [normalized])
    .limit(1)
    .maybeSingle();

  if (exact) {
    const match = toMatch(exact);
    if (match) return match;
  }

  const { data: partial } = await supabase
    .from("ncua_credit_unions")
    .select("website, address, phone")
    .ilike("name", `%${normalized}%`)
    .limit(1)
    .maybeSingle();

  if (partial) return toMatch(partial);

  return null;
}

function toMatch(row: { website: string | null; address: string | null; phone: string | null }): NcuaMatch | null {
  if (!row.website && !row.address && !row.phone) return null;
  return row;
}
