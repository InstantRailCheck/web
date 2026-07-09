import { createClient } from "@/lib/supabase/server";
import { fetchAllBanks } from "@/lib/allBanks";
import { EDD_DAYS_SENTINEL } from "@/lib/bankProfile";

const MIN_REPORTS = 2;

export type CommunityRailEntry = {
  bankId: string;
  bankSlug: string;
  bankName: string;
  successCount: number;
};

export async function getCommunityReportedBanks(rail: string): Promise<CommunityRailEntry[]> {
  const supabase = await createClient();

  const [{ data }, { data: allBanks }] = await Promise.all([
    supabase.from("route_reports").select("from_bank_id, from_bank_name, status").eq("rail_used", rail),
    supabase.from("banks").select("id, slug"),
  ]);

  const slugById = new Map((allBanks ?? []).map((b) => [b.id, b.slug]));
  const counts = new Map<string, CommunityRailEntry>();

  for (const row of data ?? []) {
    if (row.status !== "success") continue;
    const slug = slugById.get(row.from_bank_id);
    if (!slug) continue;

    const entry = counts.get(row.from_bank_id) ?? {
      bankId: row.from_bank_id,
      bankSlug: slug,
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

export type EddRankedEntry = {
  bankId: string;
  bankSlug: string;
  bankName: string;
  avgDaysEarly: number;
  reportCount: number;
  hasMoreThanFive: boolean;
};

export async function getEddRankedBanks(): Promise<EddRankedEntry[]> {
  const supabase = await createClient();

  const [{ data: eddRows }, allBanks] = await Promise.all([
    supabase.from("edd_reports").select("bank_id, days_early"),
    fetchAllBanks<{ id: string; slug: string; name: string }>(supabase, "id, slug, name"),
  ]);

  const bankById = new Map(allBanks.map((b) => [b.id, b]));
  const daysByBank = new Map<string, number[]>();
  for (const row of eddRows ?? []) {
    const arr = daysByBank.get(row.bank_id) ?? [];
    arr.push(row.days_early);
    daysByBank.set(row.bank_id, arr);
  }

  const entries: EddRankedEntry[] = [];
  for (const [bankId, days] of daysByBank) {
    if (days.length < MIN_REPORTS) continue;
    const bank = bankById.get(bankId);
    if (!bank) continue;

    entries.push({
      bankId,
      bankSlug: bank.slug,
      bankName: bank.name,
      avgDaysEarly: Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10,
      reportCount: days.length,
      hasMoreThanFive: days.includes(EDD_DAYS_SENTINEL),
    });
  }

  return entries.sort((a, b) => b.avgDaysEarly - a.avgDaysEarly);
}
