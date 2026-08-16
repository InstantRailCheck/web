"use server";
import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type MarkWatchlistActivitySeenResult = { success: true } | { error: string };

// Called by WatchlistActivityFeed after it renders the fetched items (not
// before) — the badge naturally drops to 0 on its own next fetch rather
// than the feed trying to clear it directly, so there's only ever one
// source of truth for the cutoff (watchlist_activity_last_seen), never a
// client-side cache the two components have to keep in sync.
export async function markWatchlistActivitySeen(): Promise<MarkWatchlistActivitySeenResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "You must be signed in." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("watchlist_activity_last_seen")
    .upsert({ user_id: user.id, last_seen_at: new Date().toISOString() }, { onConflict: "user_id" });

  if (error) return { error: "Failed to update watchlist activity." };

  return { success: true };
}
