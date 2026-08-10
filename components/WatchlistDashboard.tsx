"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { getWatchlist, type WatchlistBankEntry, type WatchlistRouteEntry } from "@/lib/actions/getWatchlist";
import { unfollowBank } from "@/lib/actions/unfollowBank";
import { unfollowRoute } from "@/lib/actions/unfollowRoute";
import { AuthModal } from "@/components/AuthModal";
import type { User } from "@supabase/supabase-js";

// v11.0 Phase 1: the private list half of the retention loop. Directly
// modeled on PasskeyManager's structure (auth-tracking effect, then a
// second effect keyed on [user] that fetches with a cancellation guard,
// same sign-in-card treatment when signed out). No activity feed yet —
// Phase 2.
export function WatchlistDashboard() {
  const [user, setUser] = useState<User | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [banks, setBanks] = useState<WatchlistBankEntry[]>([]);
  const [routes, setRoutes] = useState<WatchlistRouteEntry[]>([]);
  // Tracks which user id the current banks/routes actually belong to,
  // rather than a separate loading flag toggled synchronously inside the
  // effect (which trips react-hooks/set-state-in-effect) — "loading" is
  // just "signed in, but haven't loaded this user's data yet," derived
  // below. Also correctly handles a same-tab account switch, where a
  // separate boolean would otherwise flash the previous user's list.
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
    getWatchlist().then((result) => {
      if (cancelled) return;
      if ("error" in result) {
        setError(result.error);
      } else {
        setBanks(result.banks);
        setRoutes(result.routes);
      }
      setLoadedForUserId(user.id);
    });

    return () => {
      cancelled = true;
    };
  }, [user]);

  async function handleUnfollowBank(bankId: string) {
    const result = await unfollowBank(bankId);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setBanks((prev) => prev.filter((b) => b.bankId !== bankId));
  }

  async function handleUnfollowRoute(fromBankId: string, toBankId: string) {
    const result = await unfollowRoute(fromBankId, toBankId);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setRoutes((prev) => prev.filter((r) => !(r.fromBankId === fromBankId && r.toBankId === toBankId)));
  }

  if (!user) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 text-center">
        <AuthModal open={authOpen} onOpenChange={setAuthOpen} />
        <p className="text-slate-400">Sign in to see your watchlist.</p>
        <button
          onClick={() => setAuthOpen(true)}
          className="mt-4 rounded-xl bg-blue-600 px-6 py-3 font-semibold text-white transition hover:bg-blue-500"
        >
          Sign in
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
      <h2 className="text-lg font-semibold">Watchlist</h2>
      <p className="mt-1 text-sm text-slate-400">
        Banks and routes you&apos;re following. Watchlists are private — nobody else can see who follows what.
      </p>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

      <div className="mt-6">
        <h3 className="text-sm font-medium text-slate-300">Banks</h3>
        <div className="mt-2 divide-y divide-slate-800 rounded-xl border border-slate-800">
          {loading ? (
            <p className="p-4 text-sm text-slate-400">Loading...</p>
          ) : banks.length === 0 ? (
            <p className="p-4 text-sm text-slate-400">You&apos;re not following any banks yet.</p>
          ) : (
            banks.map((bank) => (
              <div key={bank.bankId} className="flex items-center justify-between gap-4 p-4 text-sm">
                <div>
                  <Link href={`/banks/${bank.bankSlug}`} className="text-slate-200 transition hover:text-blue-300">
                    {bank.bankName}
                  </Link>
                  {!bank.bankIsActive && <p className="text-xs text-yellow-400">No longer active</p>}
                </div>
                <button
                  onClick={() => handleUnfollowBank(bank.bankId)}
                  className="shrink-0 text-xs text-red-400 transition hover:text-red-300"
                >
                  Unfollow
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="mt-6">
        <h3 className="text-sm font-medium text-slate-300">Routes</h3>
        <div className="mt-2 divide-y divide-slate-800 rounded-xl border border-slate-800">
          {loading ? (
            <p className="p-4 text-sm text-slate-400">Loading...</p>
          ) : routes.length === 0 ? (
            <p className="p-4 text-sm text-slate-400">You&apos;re not watching any routes yet.</p>
          ) : (
            routes.map((route) => (
              <div
                key={`${route.fromBankId}::${route.toBankId}`}
                className="flex items-center justify-between gap-4 p-4 text-sm"
              >
                <div>
                  <p className="text-slate-200">
                    <Link href={`/banks/${route.fromBankSlug}`} className="transition hover:text-blue-300">
                      {route.fromBankName}
                    </Link>
                    {" → "}
                    <Link href={`/banks/${route.toBankSlug}`} className="transition hover:text-blue-300">
                      {route.toBankName}
                    </Link>
                  </p>
                  {(!route.fromBankIsActive || !route.toBankIsActive) && (
                    <p className="text-xs text-yellow-400">One or both banks are no longer active</p>
                  )}
                </div>
                <button
                  onClick={() => handleUnfollowRoute(route.fromBankId, route.toBankId)}
                  className="shrink-0 text-xs text-red-400 transition hover:text-red-300"
                >
                  Unwatch
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
