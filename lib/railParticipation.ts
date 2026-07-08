import { createAdminClient } from "@/lib/supabase/admin";

export type RailParticipation = {
  fednow: boolean;
  rtp: boolean;
  zelle: boolean;
};

export async function checkRailParticipation(name: string): Promise<RailParticipation> {
  const [fednow, rtp, zelle] = await Promise.all([
    matchesTable("fednow_participants", name),
    matchesTable("rtp_participants", name),
    matchesTable("zelle_participants", name),
  ]);

  return { fednow, rtp, zelle };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function matchesTable(
  table: "fednow_participants" | "rtp_participants" | "zelle_participants",
  name: string
): Promise<boolean> {
  const supabase = createAdminClient();
  // Strip commas/periods before splitting — legal names like "Capital One,
  // National Association" otherwise leave a trailing comma stuck to the
  // last word of a truncated candidate ("capital one,"), which matches
  // neither an exact nor an ilike lookup against a clean "capital one" row.
  const words = name.replace(/[.,]/g, "").trim().split(/\s+/);
  const floor = Math.min(2, words.length);

  for (let i = words.length; i >= floor; i--) {
    const candidate = words.slice(0, i).join(" ").toLowerCase().trim();

    const { data: exact } = await supabase
      .from(table)
      .select("id")
      .eq("search_name", candidate)
      .limit(1)
      .maybeSingle();

    if (exact) return true;

    // A substring match is only attempted on the complete, untruncated name
    // — a truncated candidate like "New Haven" (from "New Haven Teachers")
    // discards the part of the name that actually distinguishes the
    // institution, so even a clean match (e.g. an unrelated "New Haven
    // Bank") doesn't mean it's *this* institution.
    if (i === words.length) {
      const { data: partial } = await supabase
        .from(table)
        .select("search_name")
        .ilike("search_name", `%${candidate}%`);

      if (partial && partial.length > 0) {
        // A raw substring match can also hit unrelated names by accident —
        // "us bank" inside "pegasus bank", "chase" inside "purchase bank" —
        // so require a whole-word boundary. And a word that's genuinely
        // common ("farmers" legitimately appears in two dozen different
        // "Farmers ___ Bank" entities) still isn't safe just because it's
        // bounded — only trust it if it resolves to exactly one distinct
        // institution. More than one is real ambiguity, not a match; per
        // this project's "blank over wrong" rule, ambiguous means no match.
        const boundary = new RegExp(`\\b${escapeRegex(candidate)}\\b`, "i");
        const distinct = new Set(
          partial.filter((row) => boundary.test(row.search_name)).map((row) => row.search_name)
        );
        if (distinct.size === 1) return true;
      }
    }
  }

  return false;
}
