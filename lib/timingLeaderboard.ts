import { createClient } from "@/lib/supabase/server";

const MIN_SAMPLE_SIZE = 2;

export type LeaderboardEntry = {
  bankId: string;
  bankSlug: string;
  bankName: string;
  avgTime: number;
  sampleSize: number;
};

export async function getTimingLeaderboard(): Promise<Record<string, LeaderboardEntry[]>> {
  const supabase = await createClient();

  const [{ data }, { data: allBanks }] = await Promise.all([
    supabase
      .from("route_reports")
      .select("from_bank_id, from_bank_name, rail_used, settlement_time_minutes")
      .not("settlement_time_minutes", "is", null),
    supabase.from("banks").select("id, slug"),
  ]);

  const slugById = new Map((allBanks ?? []).map((b) => [b.id, b.slug]));
  const rows = data ?? [];

  const groups = new Map<string, { bankId: string; bankSlug: string; bankName: string; times: number[] }>();

  for (const row of rows) {
    const slug = slugById.get(row.from_bank_id);
    if (!slug) continue;

    const rail = row.rail_used || "unknown";
    const key = `${rail}::${row.from_bank_id}`;
    const group = groups.get(key) ?? {
      bankId: row.from_bank_id,
      bankSlug: slug,
      bankName: row.from_bank_name,
      times: [] as number[],
    };
    group.times.push(row.settlement_time_minutes as number);
    groups.set(key, group);
  }

  const result: Record<string, LeaderboardEntry[]> = {};

  for (const [key, group] of groups) {
    const rail = key.split("::")[0];
    if (group.times.length < MIN_SAMPLE_SIZE) continue;

    const avgTime = Math.round(
      group.times.reduce((a, b) => a + b, 0) / group.times.length
    );

    const entry: LeaderboardEntry = {
      bankId: group.bankId,
      bankSlug: group.bankSlug,
      bankName: group.bankName,
      avgTime,
      sampleSize: group.times.length,
    };

    result[rail] = result[rail] ? [...result[rail], entry] : [entry];
  }

  for (const rail of Object.keys(result)) {
    result[rail].sort((a, b) => a.avgTime - b.avgTime);
  }

  return result;
}
