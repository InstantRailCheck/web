"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getWatchlistActivityCount } from "@/lib/actions/getWatchlistActivityCount";
import type { User } from "@supabase/supabase-js";

// Same auth-tracking-effect pattern as WatchlistDashboard.tsx, but renders
// nothing when signed out (no sign-in prompt here — this is header chrome,
// not a destination) and nothing when there's no unread count. Fetches
// independently of WatchlistActivityFeed rather than being told when the
// feed marks itself seen — it'll simply read 0 on its own next mount/reload
// once watchlist_activity_last_seen has moved forward.
export function WatchlistActivityBadge() {
  const [user, setUser] = useState<User | null>(null);
  const [count, setCount] = useState(0);

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
    getWatchlistActivityCount().then((result) => {
      if (cancelled) return;
      if (!("error" in result)) setCount(result.count);
    });

    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!user || count === 0) return null;

  return (
    <Link
      href="/account"
      aria-label={`${count} new update${count !== 1 ? "s" : ""} on your watchlist`}
      className="relative inline-flex items-center rounded-full border border-slate-700 bg-slate-800 p-2 text-slate-300 transition hover:bg-slate-700 hover:text-white"
    >
      <Bell className="h-4 w-4" />
      <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
        {count > 9 ? "9+" : count}
      </span>
    </Link>
  );
}
