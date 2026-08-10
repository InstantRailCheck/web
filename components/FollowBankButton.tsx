"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bookmark, BookmarkCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { followBank } from "@/lib/actions/followBank";
import { unfollowBank } from "@/lib/actions/unfollowBank";
import { getBankFollowStatus } from "@/lib/actions/getBankFollowStatus";
import { AuthModal } from "@/components/AuthModal";
import { cn } from "@/lib/utils";
import type { User } from "@supabase/supabase-js";

type Props = {
  bankId: string;
  bankName: string;
  className?: string;
};

// v11.0: the first piece of the retention loop (follow -> receive an
// update -> return). Directly modeled on RequestRouteButton's auth-
// tracking + Server Action shape, plus a second effect (mirroring
// PasskeyManager's fetch-after-auth pattern) to learn the current follow
// state on mount, since unlike a route request this is a toggle.
export function FollowBankButton({ bankId, bankName, className }: Props) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [fetchedFollowing, setFollowing] = useState(false);
  // Derived, not effect-reset: a sign-out must never leave a stale
  // "Following" label visible from a previous session, but resetting that
  // via a synchronous setState in the effect below (rather than deriving
  // it here) trips react-hooks/set-state-in-effect for no real benefit.
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
    getBankFollowStatus(bankId).then(({ following }) => {
      if (!cancelled) setFollowing(following);
    });

    return () => {
      cancelled = true;
    };
  }, [user, bankId]);

  async function handleClick() {
    if (!user) {
      setAuthOpen(true);
      return;
    }

    setLoading(true);
    setError(null);

    const result = following ? await unfollowBank(bankId) : await followBank(bankId);

    setLoading(false);

    if ("error" in result) {
      setError(result.error);
      return;
    }

    setFollowing(!following);
    router.refresh();
  }

  return (
    <div className={cn("flex flex-col items-center gap-1", className)}>
      <AuthModal open={authOpen} onOpenChange={setAuthOpen} />
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        aria-pressed={following}
        aria-label={following ? `Unfollow ${bankName}` : `Follow ${bankName}`}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition disabled:opacity-50",
          following
            ? "border-blue-500 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20"
            : "border-slate-700 text-slate-300 hover:border-blue-500/40 hover:text-white"
        )}
      >
        {following ? <BookmarkCheck className="h-3.5 w-3.5" /> : <Bookmark className="h-3.5 w-3.5" />}
        {following ? "Following" : "Follow this bank"}
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
