import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeForSearch } from "@/lib/utils";
import { matchInstitution, type LocationFields, type RailCandidate } from "@/lib/railParticipationMatch";

export type RailParticipation = {
  fednow: boolean;
  rtp: boolean;
  zelle: boolean;
};

export type BankForRailMatch = {
  name: string;
  city: string | null;
  state: string | null;
};

export async function checkRailParticipation(bank: BankForRailMatch): Promise<RailParticipation> {
  const supabase = createAdminClient();

  // Every ACTIVE bank sharing this bank's normalized name, including
  // itself — a group of exactly one means this isn't a duplicate-name
  // situation at all, and matchInstitution falls back to the original
  // name-only matching (location irrelevant). Queries name_only_normalized
  // (bare name), not name_normalized — that column bakes in aka_names for
  // fuzzy search, so a sibling carrying aliases would silently never match
  // this .eq() and get excluded from its own duplicate-name group. An
  // inactive/merged bank is excluded so it can't manufacture false
  // ambiguity for an active sibling (same fix already applied to
  // backfill-rail-participation.mjs/audit-duplicate-name-rail-flags.mjs).
  const { data: siblingRows } = await supabase
    .from("banks")
    .select("city, state")
    .eq("name_only_normalized", normalizeForSearch(bank.name))
    .eq("is_active", true);
  const siblingLocations = (siblingRows ?? []).map((r) => ({ city: r.city, state: r.state }));

  const [fednow, rtp, zelle] = await Promise.all([
    matchesTable(supabase, "fednow_participants", "city_state", bank, siblingLocations),
    matchesTable(supabase, "rtp_participants", "state", bank, siblingLocations),
    matchesTable(supabase, "zelle_participants", "none", bank, siblingLocations),
  ]);

  return { fednow, rtp, zelle };
}

// One full-table fetch per rail per call rather than the original per-
// truncation-level exact/ilike round trips — these participant lists are
// on the same order of size as `banks` itself (low thousands), and this
// runs on an occasional user action (adding a bank, submitting a
// correction), never a hot path or a bulk loop (that case is
// scripts/backfill-rail-participation.mjs's own single-prefetch design).
// Building a targeted equivalent query would mean hand-escaping bank names
// into a raw PostgREST .or() filter string, which is real injection/
// parsing risk for a name containing '(', ')', or ',' — not worth it here.
async function matchesTable(
  supabase: ReturnType<typeof createAdminClient>,
  table: "fednow_participants" | "rtp_participants" | "zelle_participants",
  locationFields: LocationFields,
  bank: BankForRailMatch,
  siblingLocations: Array<{ city: string | null; state: string | null }>
): Promise<boolean> {
  const columns =
    locationFields === "city_state" ? "search_name, city, state" : locationFields === "state" ? "search_name, state" : "search_name";

  const { data } = await supabase.from(table).select(columns);
  // supabase-js infers a row shape from the select() string via a
  // template-literal parser, which can't handle a runtime-computed
  // column list — the three tables genuinely have different columns
  // (zelle_participants has neither city nor state), so this can't be
  // resolved with a literal string either. Cast through unknown, same as
  // the underlying data's real (partial) shape below.
  const candidates: RailCandidate[] = ((data ?? []) as unknown as Array<{ search_name: string; city?: string; state?: string }>).map((row) => ({
    searchName: row.search_name,
    city: row.city ?? null,
    state: row.state ?? null,
  }));

  return matchInstitution(bank, siblingLocations, candidates, locationFields) === "matched";
}
