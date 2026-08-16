"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { getWatchlistActivity } from "@/lib/actions/getWatchlistActivity";
import { markWatchlistActivitySeen } from "@/lib/actions/markWatchlistActivitySeen";
import type { WatchlistActivityItem } from "@/lib/watchlistActivity";
import { railDisplayName } from "@/lib/railDisplayName";
import type { User } from "@supabase/supabase-js";

// Matches the rail color scheme used in RouteSearch/changelog so a rail is
// recognizable by color site-wide.
const RAIL_COLORS: Record<string, string> = {
  RTP: "text-green-300",
  FedNow: "text-purple-300",
  ACH: "text-blue-300",
  Wire: "text-slate-300",
  Zelle: "text-white",
  "Visa Direct": "text-sky-300",
  "Mastercard Send": "text-orange-300",
};

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// Same auth-tracking-effect + [user]-keyed fetch-with-cancellation pattern
// as WatchlistDashboard.tsx. Marks the feed seen only after a successful
// fetch renders — the header's own badge (WatchlistActivityBadge) polls
// last_seen_at independently on its next load rather than being told
// directly, so there's exactly one source of truth for "what's unread."
export function WatchlistActivityFeed() {
  const [user, setUser] = useState<User | null>(null);
  const [items, setItems] = useState<WatchlistActivityItem[]>([]);
  const [loadedForUserId, setLoadedForUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loading = user !== null && loadedForUserId !== user.id;

  useEffect(() => {
    const supabase = createClient();

    supabase.auth.getUser().then(({ data }) => setUser(data.user));

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_, session) => setUser(session?.user ?? null));

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;
    getWatchlistActivity().then((result) => {
      if (cancelled) return;
      if ("error" in result) {
        setError(result.error);
      } else {
        setItems(result.items);
      }
      setLoadedForUserId(user.id);
      // Fired after the fetch resolves (not before/in parallel), so the
      // fetch always reflects the previous last_seen_at rather than racing
      // against its own update.
      void markWatchlistActivitySeen();
    });

    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!user) return null;

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
      <h2 className="text-lg font-semibold">Activity</h2>
      <p className="mt-1 text-sm text-slate-400">New community reports on the banks and routes you follow.</p>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

      <div className="mt-4 divide-y divide-slate-800 rounded-xl border border-slate-800">
        {loading ? (
          <p className="p-4 text-sm text-slate-400">Loading...</p>
        ) : items.length === 0 ? (
          <p className="p-4 text-sm text-slate-400">No new activity on your watchlist yet.</p>
        ) : (
          items.map((item) => (
            <div key={item.key} className="flex items-start justify-between gap-4 p-4 text-sm">
              <div>
                <p>
                  <Link href={`/banks/${item.fromBankSlug}`} className="text-blue-400 transition hover:text-blue-300">
                    {item.fromBankName}
                  </Link>
                  <span className="text-slate-400"> → </span>
                  <Link href={`/banks/${item.toBankSlug}`} className="text-blue-400 transition hover:text-blue-300">
                    {item.toBankName}
                  </Link>
                  <span className="text-slate-400"> via </span>
                  <span className={RAIL_COLORS[item.rail] ?? "text-slate-200"}>{railDisplayName(item.rail)}</span>
                </p>
                <p className="mt-1 text-slate-300">{item.changeLabel}</p>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <Link
                    href={`/?from=${item.fromBankSlug}&to=${item.toBankSlug}#search`}
                    className="text-slate-400 underline-offset-2 transition hover:text-blue-300 hover:underline"
                  >
                    View route
                  </Link>
                  <Link
                    href={`/?from=${item.fromBankSlug}&to=${item.toBankSlug}#submit-route-report`}
                    className="text-slate-400 underline-offset-2 transition hover:text-blue-300 hover:underline"
                  >
                    Contribute an update
                  </Link>
                </div>
              </div>
              <span className="shrink-0 text-xs text-slate-400">{timeAgo(item.latestReportAt)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
