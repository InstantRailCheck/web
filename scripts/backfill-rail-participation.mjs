import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function matchesTable(table, name) {
  const words = name.trim().split(/\s+/);
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

    const { data: partial } = await supabase
      .from(table)
      .select("id")
      .ilike("search_name", `%${candidate}%`)
      .limit(1)
      .maybeSingle();

    if (partial) return true;
  }

  return false;
}

async function main() {
  const { data: banks, error } = await supabase.from("banks").select("id, name");
  if (error) throw error;

  console.log(`Processing ${banks.length} bank(s).`);

  for (const bank of banks) {
    const fednow = await matchesTable("fednow_participants", bank.name);
    const rtp = await matchesTable("rtp_participants", bank.name);

    const { error: updateError } = await supabase
      .from("banks")
      .update({ fednow_participant: fednow, rtp_participant: rtp })
      .eq("id", bank.id);

    if (updateError) {
      console.log(`- ${bank.name}: update failed — ${updateError.message}`);
    } else {
      console.log(`- ${bank.name}: FedNow=${fednow} RTP=${rtp}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
