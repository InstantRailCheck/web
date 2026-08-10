"use server";
import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type WatchlistBankEntry = {
  bankId: string;
  bankName: string;
  bankSlug: string;
  bankIsActive: boolean;
  followedAt: string;
};

export type WatchlistRouteEntry = {
  fromBankId: string;
  fromBankName: string;
  fromBankSlug: string;
  fromBankIsActive: boolean;
  toBankId: string;
  toBankName: string;
  toBankSlug: string;
  toBankIsActive: boolean;
  followedAt: string;
};

export type GetWatchlistResult = { banks: WatchlistBankEntry[]; routes: WatchlistRouteEntry[] } | { error: string };

type BankRow = { id: string; name: string; slug: string; is_active: boolean };

// A followed bank that's gone inactive (or been merged into another bank)
// must still display truthfully, never silently vanish or claim to still
// be active — "unknown is better than wrong" applies to a user's own
// watchlist too. Bank-merge propagation (a followed bank's id changing out
// from under a follow row) is an explicit non-goal for this phase.
export async function getWatchlist(): Promise<GetWatchlistResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "You must be signed in." };

  const admin = createAdminClient();

  const [{ data: bankFollows, error: bankFollowsError }, { data: routeFollows, error: routeFollowsError }] =
    await Promise.all([
      admin
        .from("watchlist_bank_follows")
        .select("bank_id, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }),
      admin
        .from("watchlist_route_follows")
        .select("from_bank_id, to_bank_id, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }),
    ]);

  if (bankFollowsError || routeFollowsError) return { error: "Failed to load your watchlist." };

  const bankIds = new Set<string>();
  for (const row of bankFollows ?? []) bankIds.add(row.bank_id);
  for (const row of routeFollows ?? []) {
    bankIds.add(row.from_bank_id);
    bankIds.add(row.to_bank_id);
  }

  const { data: banks, error: banksError } =
    bankIds.size > 0
      ? await admin.from("banks").select("id, name, slug, is_active").in("id", [...bankIds])
      : { data: [] as BankRow[], error: null };
  if (banksError) return { error: "Failed to load your watchlist." };

  const bankById = new Map((banks ?? []).map((b) => [b.id, b as BankRow]));

  const watchlistBanks: WatchlistBankEntry[] = (bankFollows ?? []).flatMap((row) => {
    const bank = bankById.get(row.bank_id);
    if (!bank) return [];
    return [
      {
        bankId: bank.id,
        bankName: bank.name,
        bankSlug: bank.slug,
        bankIsActive: bank.is_active,
        followedAt: row.created_at,
      },
    ];
  });

  const watchlistRoutes: WatchlistRouteEntry[] = (routeFollows ?? []).flatMap((row) => {
    const fromBank = bankById.get(row.from_bank_id);
    const toBank = bankById.get(row.to_bank_id);
    if (!fromBank || !toBank) return [];
    return [
      {
        fromBankId: fromBank.id,
        fromBankName: fromBank.name,
        fromBankSlug: fromBank.slug,
        fromBankIsActive: fromBank.is_active,
        toBankId: toBank.id,
        toBankName: toBank.name,
        toBankSlug: toBank.slug,
        toBankIsActive: toBank.is_active,
        followedAt: row.created_at,
      },
    ];
  });

  return { banks: watchlistBanks, routes: watchlistRoutes };
}
