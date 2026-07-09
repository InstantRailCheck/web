import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Same word-boundary + uniqueness-of-1 matching as before, but operating on
// an in-memory Set of search_names instead of issuing a DB round-trip per
// truncation level per table per bank. The original DB-query version does
// roughly banks x tables x truncation-levels network calls — for ~4,700
// banks that's on the order of tens of thousands of sequential round-trips,
// which made this take hours once it started running unattended on a cron
// instead of occasionally by hand. Matching semantics are unchanged.
function matchesSet(name, searchNames) {
  const words = name.replace(/[.,]/g, "").trim().split(/\s+/);
  const floor = Math.min(2, words.length);

  for (let i = words.length; i >= floor; i--) {
    const candidate = words.slice(0, i).join(" ").toLowerCase().trim();

    if (searchNames.has(candidate)) return true;

    if (i === words.length) {
      const boundary = new RegExp(`\\b${escapeRegex(candidate)}\\b`, "i");
      const distinct = new Set();
      for (const sn of searchNames) {
        if (boundary.test(sn)) distinct.add(sn);
      }
      if (distinct.size === 1) return true;
    }
  }

  return false;
}

async function fetchAllRows(table, columns, orderBy) {
  // Supabase caps a single select() at 1000 rows by default.
  const pageSize = 1000;
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .order(orderBy, { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}

async function main() {
  console.log("Loading participant lists...");
  const [fednowRows, rtpRows, zelleRows, banks] = await Promise.all([
    fetchAllRows("fednow_participants", "search_name", "id"),
    fetchAllRows("rtp_participants", "search_name", "id"),
    fetchAllRows("zelle_participants", "search_name", "id"),
    fetchAllRows("banks", "id, name, fednow_participant, rtp_participant, zelle_participant", "id"),
  ]);

  const fednowSet = new Set(fednowRows.map((r) => r.search_name));
  const rtpSet = new Set(rtpRows.map((r) => r.search_name));
  const zelleSet = new Set(zelleRows.map((r) => r.search_name));

  console.log(`Processing ${banks.length} bank(s).`);

  let updated = 0;
  for (const bank of banks) {
    // Never downgrade an already-true flag — a positive confirmation (even
    // a manual one) outweighs an absence in a source that can be incomplete.
    const fednow = bank.fednow_participant || matchesSet(bank.name, fednowSet);
    const rtp = bank.rtp_participant || matchesSet(bank.name, rtpSet);
    const zelle = bank.zelle_participant || matchesSet(bank.name, zelleSet);

    if (
      fednow === bank.fednow_participant &&
      rtp === bank.rtp_participant &&
      zelle === bank.zelle_participant
    ) {
      continue;
    }

    const { error: updateError } = await supabase
      .from("banks")
      .update({ fednow_participant: fednow, rtp_participant: rtp, zelle_participant: zelle })
      .eq("id", bank.id);

    if (updateError) {
      console.log(`- ${bank.name}: update failed — ${updateError.message}`);
    } else {
      updated++;
      console.log(`- ${bank.name}: FedNow=${fednow} RTP=${rtp} Zelle=${zelle}`);
    }
  }

  console.log(`Done. Updated ${updated}/${banks.length} bank(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
