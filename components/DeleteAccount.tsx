"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { deleteAccount } from "@/lib/actions/deleteAccount";
import type { User } from "@supabase/supabase-js";

export function DeleteAccount() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [confirming, setConfirming] = useState(false);
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

  async function handleConfirmedDelete() {
    setLoading(true);
    setError(null);

    const result = await deleteAccount();

    if ("error" in result) {
      setError(result.error);
      setLoading(false);
      return;
    }

    // Deleting the auth.users row server-side doesn't clear this browser's
    // local session — sign out explicitly so the UI reflects reality
    // immediately instead of appearing to still be signed in.
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/?account_deleted=1");
  }

  // No sign-in prompt of its own — PasskeyManager already shows one above
  // this on /account, and there's nothing meaningful to offer someone who
  // isn't signed in to begin with.
  if (!user) return null;

  return (
    <div className="mt-6 rounded-2xl border border-red-900/50 bg-red-950/20 p-6">
      <h2 className="text-lg font-semibold text-red-300">Delete account</h2>
      <p className="mt-1 text-sm text-slate-400">
        Permanently deletes your sign-in, passkeys, and registered webhooks. Route reports, EDD
        reports, and corrections you&apos;ve submitted stay on the site as anonymous community
        data — no longer linked to you — rather than being removed, since other people&apos;s view
        of a bank or route may depend on them. This can&apos;t be undone.
      </p>

      {!confirming ? (
        <button
          onClick={() => setConfirming(true)}
          className="mt-4 rounded-lg border border-red-800 px-4 py-2 text-sm font-semibold text-red-300 transition hover:bg-red-900/30"
        >
          Delete my account
        </button>
      ) : (
        <div className="mt-4 space-y-3 rounded-xl border border-red-900/50 bg-slate-950 p-4">
          <p className="text-sm font-medium text-white">Are you sure? This is permanent.</p>
          <div className="flex gap-2">
            <button
              onClick={handleConfirmedDelete}
              disabled={loading}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Deleting..." : "Yes, delete my account"}
            </button>
            <button
              onClick={() => setConfirming(false)}
              disabled={loading}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
    </div>
  );
}
