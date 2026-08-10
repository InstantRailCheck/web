"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bookmark, BookmarkCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { followRoute } from "@/lib/actions/followRoute";
import { unfollowRoute } from "@/lib/actions/unfollowRoute";
import { getRouteFollowStatus } from "@/lib/actions/getRouteFollowStatus";
import { AuthModal } from "@/components/AuthModal";
import { cn } from "@/lib/utils";
import type { User } from "@supabase/supabase-js";

type Props = {
  fromBankId: string;
  toBankId: string;
  className?: string;
};

// v11.0: same shape as RequestRouteButton, but a toggle (needs to know
// current follow state on mount) rather than a one-way action — see
// FollowBankButton for the same pattern applied to a bank.
export function WatchRouteButton({ fromBankId, toBankId, className }: Props) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [fetchedFollowing, setFollowing] = useState(false);
  // Derived, not effect-reset — see FollowBankButton for why.
  const following = user ? fetchedFollowing : false;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    getRouteFollowStatus(fromBankId, toBankId).then(({ following }) => {
      if (!cancelled) setFollowing(following);
    });

    return () => {
      cancelled = true;
    };
  }, [user, fromBankId, toBankId]);

  async function handleClick() {
    if (!user) {
      setAuthOpen(true);
      return;
    }

    setLoading(true);
    setError(null);

    const result = following ? await unfollowRoute(fromBankId, toBankId) : await followRoute(fromBankId, toBankId);

    setLoading(false);

    if ("error" in result) {
      setError(result.error);
      return;
    }

    setFollowing(!following);
    router.refresh();
  }

  return (
    <div className={cn("flex shrink-0 flex-col items-end gap-1", className)}>
      <AuthModal open={authOpen} onOpenChange={setAuthOpen} />
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        aria-pressed={following}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-blue-500/40 hover:text-white disabled:opacity-50"
      >
        {following ? <BookmarkCheck className="h-3.5 w-3.5" /> : <Bookmark className="h-3.5 w-3.5" />}
        {following ? "Watching" : "Watch this route"}
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
