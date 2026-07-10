import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export type ActivityItem =
  | { type: "bank_added"; id: string; bankId: string; bankSlug: string; bankName: string; createdAt: string }
  | {
      type: "report";
      id: string;
      fromBankId: string;
      fromBankSlug: string | null;
      fromBankName: string;
      toBankName: string;
      rail: string;
      status: string;
      isFirstConfirmed: boolean;
      createdAt: string;
    };

export async function getActivityFeed(limit = 30): Promise<ActivityItem[]> {
  const supabase = createAdminClient();

  const [{ data: banks }, { data: reports }, { data: allSuccess }, { data: allBanks }] = await Promise.all([
    supabase
      .from("banks")
      .select("id, slug, name, created_at")
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase
      .from("route_reports")
      .select("id, from_bank_id, from_bank_name, to_bank_name, rail_used, status, created_at")
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase
      .from("route_reports")
      .select("id, from_bank_id, rail_used, created_at")
      .eq("status", "success")
      .order("created_at", { ascending: true }),
    // route_reports only stores from_bank_id/name denormalized, not slug —
    // need a full id->slug map to link report items to their bank pages.
    supabase.from("banks").select("id, slug"),
  ]);

  const slugById = new Map((allBanks ?? []).map((b) => [b.id, b.slug]));

  const firstConfirmedIds = new Set<string>();
  const seenKeys = new Set<string>();
  for (const row of allSuccess ?? []) {
    const key = `${row.from_bank_id}::${row.rail_used}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      firstConfirmedIds.add(row.id);
    }
  }

  const bankItems: ActivityItem[] = (banks ?? []).map((b) => ({
    type: "bank_added",
    id: `bank-${b.id}`,
    bankId: b.id,
    bankSlug: b.slug,
    bankName: b.name,
    createdAt: b.created_at,
  }));

  const reportItems: ActivityItem[] = (reports ?? []).map((r) => ({
    type: "report",
    id: `report-${r.id}`,
    fromBankId: r.from_bank_id,
    fromBankSlug: slugById.get(r.from_bank_id) ?? null,
    fromBankName: r.from_bank_name,
    toBankName: r.to_bank_name,
    rail: r.rail_used || "Unknown",
    status: r.status,
    isFirstConfirmed: r.status === "success" && firstConfirmedIds.has(r.id),
    createdAt: r.created_at,
  }));

  return [...bankItems, ...reportItems]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);
}
