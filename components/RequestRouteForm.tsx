"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BankSelect, type Bank } from "@/components/BankSelect";
import { AuthModal } from "@/components/AuthModal";
import { createClient } from "@/lib/supabase/client";
import { requestRoute } from "@/lib/actions/requestRoute";
import type { User } from "@supabase/supabase-js";

// The only way a "requested_only" pair (lib/needsFreshReports.ts) can come
// into existence: every other entry point (RequestRouteButton on an
// already-listed row, or on the homepage CTA) already has a fromBank/toBank
// pair with existing route_reports history. This form lets a visitor
// request a pair that isn't listed at all yet. Deliberately a much smaller
// field set than SubmitRouteReport — a request carries no rail/direction/
// status/date/notes, since it's a demand signal, not evidence.
export function RequestRouteForm() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [fromBank, setFromBank] = useState<Bank | null>(null);
  const [toBank, setToBank] = useState<Bank | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // BankSelect manages its own selected-bank state internally — bump this
  // key to force both sides to remount and clear after a successful submit.
  const [resetKey, setResetKey] = useState(0);

  useEffect(() => {
    const supabase = createClient();

    supabase.auth.getUser().then(({ data }) => setUser(data.user));

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_, session) => setUser(session?.user ?? null));

    return () => subscription.unsubscribe();
  }, []);

  async function handleSubmit() {
    if (!user) {
      setAuthOpen(true);
      return;
    }

    setLoading(true);
    setSuccess(false);
    setError(null);

    try {
      if (!fromBank || !toBank) {
        throw new Error("Please choose both banks.");
      }
      if (fromBank.id === toBank.id) {
        throw new Error("Sender and receiver banks must be different.");
      }

      const result = await requestRoute(fromBank.id, toBank.id);
      if ("error" in result) throw new Error(result.error);

      setFromBank(null);
      setToBank(null);
      setResetKey((k) => k + 1);
      setSuccess(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <AuthModal open={authOpen} onOpenChange={setAuthOpen} />
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
        <h2 className="text-center text-lg font-semibold">Don&apos;t see the route you&apos;re looking for?</h2>
        <p className="mt-1 text-center text-sm text-slate-400">
          Request it — this adds a demand signal, not a report. If you already have a real transfer
          outcome to share, use the report form on the homepage instead.
        </p>

        {!user ? (
          <div className="mt-4 text-center">
            <button
              onClick={() => setAuthOpen(true)}
              className="rounded-xl bg-blue-600 px-6 py-3 font-semibold text-white transition hover:bg-blue-500"
            >
              Sign in to request a route
            </button>
          </div>
        ) : (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <BankSelect
              key={`from-${resetKey}`}
              label="From bank"
              placeholder="Sender bank"
              onChange={setFromBank}
              centerLabel
              centerText
            />
            <BankSelect
              key={`to-${resetKey}`}
              label="To bank"
              placeholder="Receiver bank"
              onChange={setToBank}
              centerLabel
              centerText
            />

            <button
              onClick={handleSubmit}
              disabled={loading}
              className="rounded-xl bg-blue-600 px-6 py-3 font-semibold text-white md:col-span-2 disabled:opacity-50"
            >
              {loading ? "Requesting..." : "Request this route"}
            </button>

            {success && (
              <p className="text-sm text-green-400 md:col-span-2">Request submitted — thank you!</p>
            )}

            {error && <p className="text-sm text-red-400 md:col-span-2">{error}</p>}
          </div>
        )}
      </div>
    </>
  );
}
