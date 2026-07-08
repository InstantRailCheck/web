"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AuthModal } from "@/components/AuthModal";
import type { User } from "@supabase/supabase-js";

type Passkey = {
  id: string;
  friendly_name?: string;
  created_at: string;
  last_used_at?: string;
};

export function PasskeyManager() {
  const [user, setUser] = useState<User | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();

    supabase.auth.getUser().then(({ data }) => setUser(data.user));

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_, session) => setUser(session?.user ?? null));

    return () => subscription.unsubscribe();
  }, []);

  async function refreshPasskeys() {
    const supabase = createClient();
    const { data, error } = await supabase.auth.passkey.list();
    if (!error && data) setPasskeys(data);
  }

  useEffect(() => {
    if (user) refreshPasskeys();
  }, [user]);

  async function handleRegister() {
    setRegistering(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.registerPasskey();
    setRegistering(false);
    if (error) {
      setError(error.message);
    } else {
      await refreshPasskeys();
    }
  }

  async function handleDelete(passkeyId: string) {
    const supabase = createClient();
    await supabase.auth.passkey.delete({ passkeyId });
    await refreshPasskeys();
  }

  if (!user) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 text-center">
        <AuthModal open={authOpen} onOpenChange={setAuthOpen} />
        <p className="text-slate-400">Sign in to manage your account.</p>
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
      <p className="text-sm text-slate-400">
        Signed in as <span className="text-slate-200">{user.email}</span>.
      </p>

      <div className="mt-6">
        <h2 className="text-lg font-semibold">Passkeys</h2>
        <p className="mt-1 text-sm text-slate-400">
          Sign in with your device's fingerprint, face, or screen lock instead of an email code.
        </p>

        <button
          onClick={handleRegister}
          disabled={registering}
          className="mt-4 rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {registering ? "Waiting for device..." : "Add a passkey"}
        </button>

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

        <div className="mt-6 divide-y divide-slate-800 rounded-xl border border-slate-800">
          {passkeys.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">No passkeys registered yet.</p>
          ) : (
            passkeys.map((pk) => (
              <div key={pk.id} className="flex items-center justify-between gap-4 p-4 text-sm">
                <div>
                  <p className="text-slate-200">{pk.friendly_name || "Passkey"}</p>
                  <p className="text-xs text-slate-500">
                    Added {new Date(pk.created_at).toLocaleDateString()}
                    {pk.last_used_at && ` · last used ${new Date(pk.last_used_at).toLocaleDateString()}`}
                  </p>
                </div>
                <button
                  onClick={() => handleDelete(pk.id)}
                  className="shrink-0 text-xs text-red-400 hover:text-red-300 transition"
                >
                  Delete
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
