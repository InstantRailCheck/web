import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function matchesTable(table, name) {
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
    // institution. Even then, require a whole-word boundary (so "chase"
    // inside "purchase bank" doesn't count, but "chase" inside "jpmorgan
    // chase bank" does) and exactly one distinct match — a word that's
    // genuinely common ("farmers" in two dozen "Farmers ___ Bank" entities)
    // resolving to many institutions is ambiguity, not a match, and per
    // this project's "blank over wrong" rule, ambiguous means no match.
    if (i === words.length) {
      const { data: partial } = await supabase
        .from(table)
        .select("search_name")
        .ilike("search_name", `%${candidate}%`);

      if (partial && partial.length > 0) {
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

async function main() {
  const { data: banks, error } = await supabase
    .from("banks")
    .select("id, name, fednow_participant, rtp_participant, zelle_participant");
  if (error) throw error;

  console.log(`Processing ${banks.length} bank(s).`);

  for (const bank of banks) {
    // Never downgrade an already-true flag — a positive confirmation (even
    // a manual one) outweighs an absence in a source that can be incomplete.
    const fednow = bank.fednow_participant || (await matchesTable("fednow_participants", bank.name));
    const rtp = bank.rtp_participant || (await matchesTable("rtp_participants", bank.name));
    const zelle = bank.zelle_participant || (await matchesTable("zelle_participants", bank.name));

    const { error: updateError } = await supabase
      .from("banks")
      .update({ fednow_participant: fednow, rtp_participant: rtp, zelle_participant: zelle })
      .eq("id", bank.id);

    if (updateError) {
      console.log(`- ${bank.name}: update failed — ${updateError.message}`);
    } else {
      console.log(`- ${bank.name}: FedNow=${fednow} RTP=${rtp} Zelle=${zelle}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
