"use server";
import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getWatchlist } from "@/lib/actions/getWatchlist";
import {
  activityQueryCutoff,
  buildWatchlistFollowIndex,
  matchesWatchlist,
  resolveActivityLastSeenAt,
} from "@/lib/watchlistActivity";

export type GetWatchlistActivityCountResult = { count: number } | { error: string };

// A cheap, header-friendly sibling of getWatchlistActivity.ts — same
// matching rules and the same last_seen_at cutoff (via the shared helpers
// in lib/watchlistActivity.ts, so the badge and the feed can never
// disagree), but a raw qualifying-report count instead of the full
// evidence-diffing pass. No history fetch, no computeRouteEvidence calls.
export async function getWatchlistActivityCount(): Promise<GetWatchlistActivityCountResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "You must be signed in." };

  const watchlist = await getWatchlist();
  if ("error" in watchlist) return watchlist;

  const index = buildWatchlistFollowIndex(watchlist);
  if (index.allBankIds.size === 0) return { count: 0 };

  const admin = createAdminClient();
  const { data: lastSeenRow } = await admin
    .from("watchlist_activity_last_seen")
    .select("last_seen_at")
    .eq("user_id", user.id)
    .maybeSingle();

  const lastSeenAt = resolveActivityLastSeenAt(lastSeenRow?.last_seen_at);
  const ids = [...index.allBankIds];

  const { data, error } = await admin
    .from("route_reports")
    .select("from_bank_id, to_bank_id")
    .or(`from_bank_id.in.(${ids.join(",")}),to_bank_id.in.(${ids.join(",")})`)
    .gte("created_at", activityQueryCutoff(lastSeenAt))
    .neq("user_id", user.id)
    .not("user_id", "is", null);

  if (error) return { error: "Failed to load watchlist activity." };

  const count = (data ?? []).filter((row) => matchesWatchlist(row, index)).length;

  return { count };
}
