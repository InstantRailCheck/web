import { createClient } from "@/lib/supabase/server";

const MIN_REPORTS = 2;

export type CommunityRailEntry = {
  bankId: string;
  bankName: string;
  successCount: number;
};

export async function getCommunityReportedBanks(rail: string): Promise<CommunityRailEntry[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("route_reports")
    .select("from_bank_id, from_bank_name, status")
    .eq("rail_used", rail);

  const counts = new Map<string, CommunityRailEntry>();

  for (const row of data ?? []) {
    if (row.status !== "success") continue;
    const entry = counts.get(row.from_bank_id) ?? {
      bankId: row.from_bank_id,
      bankName: row.from_bank_name,
      successCount: 0,
    };
    entry.successCount += 1;
    counts.set(row.from_bank_id, entry);
  }

  return Array.from(counts.values())
    .filter((e) => e.successCount >= MIN_REPORTS)
    .sort((a, b) => b.successCount - a.successCount);
}
