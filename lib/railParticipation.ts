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
