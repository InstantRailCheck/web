"use server";
import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getWatchlist } from "@/lib/actions/getWatchlist";
import { computeWatchlistActivity, resolveActivityLastSeenAt, type WatchlistActivityItem } from "@/lib/watchlistActivity";

export type GetWatchlistActivityResult = { items: WatchlistActivityItem[] } | { error: string };

export async function getWatchlistActivity(): Promise<GetWatchlistActivityResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "You must be signed in." };

  const watchlist = await getWatchlist();
  if ("error" in watchlist) return watchlist;

  const admin = createAdminClient();
  const { data: lastSeenRow } = await admin
    .from("watchlist_activity_last_seen")
    .select("last_seen_at")
    .eq("user_id", user.id)
    .maybeSingle();

  const lastSeenAt = resolveActivityLastSeenAt(lastSeenRow?.last_seen_at);
  const items = await computeWatchlistActivity(user.id, watchlist, lastSeenAt);

  return { items };
}
