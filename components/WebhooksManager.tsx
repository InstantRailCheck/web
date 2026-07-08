"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AuthModal } from "@/components/AuthModal";
import { registerWebhook, listWebhooks, deleteWebhook, type Webhook } from "@/lib/actions/webhooks";
import type { User } from "@supabase/supabase-js";

export function WebhooksManager() {
  const [user, setUser] = useState<User | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newSecret, setNewSecret] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();

    supabase.auth.getUser().then(({ data }) => setUser(data.user));

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_, session) => setUser(session?.user ?? null));

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (user) {
      listWebhooks().then(setWebhooks);
    }
  }, [user]);

  async function handleRegister() {
    setLoading(true);
    setError(null);
    setNewSecret(null);
    try {
      const result = await registerWebhook(url, "bank_added");
      if ("error" in result) {
        setError(result.error);
      } else {
        setNewSecret(result.secret);
        setUrl("");
        setWebhooks(await listWebhooks());
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string) {
    await deleteWebhook(id);
    setWebhooks(await listWebhooks());
  }

  if (!user) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 text-center">
        <AuthModal open={authOpen} onOpenChange={setAuthOpen} />
        <p className="text-slate-400">Sign in to manage webhooks.</p>
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
        Fires a signed POST to your URL whenever a new bank is added. Up to 5 webhooks per
        account. Deliveries aren't retried — check your endpoint returns a 2xx quickly.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://your-server.com/webhook"
          className="min-w-[220px] flex-1 rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm text-white placeholder-slate-500"
        />
        <button
          onClick={handleRegister}
          disabled={!url.trim() || loading}
          className="rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Adding..." : "Add webhook (bank_added)"}
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

      {newSecret && (
        <div className="mt-3 rounded-lg border border-green-500/30 bg-green-500/10 p-3 text-sm">
          <p className="text-green-300">Webhook registered. Save this secret — it won't be shown again:</p>
          <code className="mt-1 block break-all text-xs text-green-200">{newSecret}</code>
          <p className="mt-1 text-xs text-slate-400">
            Verify deliveries with HMAC-SHA256 of the raw body against this secret, sent in the{" "}
            <code>X-InstantRailCheck-Signature</code> header.
          </p>
        </div>
      )}

      <div className="mt-6 divide-y divide-slate-800 rounded-xl border border-slate-800">
        {webhooks.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">No webhooks registered yet.</p>
        ) : (
          webhooks.map((wh) => (
            <div key={wh.id} className="flex items-center justify-between gap-4 p-4 text-sm">
              <div>
                <p className="text-slate-200">{wh.url}</p>
                <p className="text-xs text-slate-500">
                  {wh.event} · added {new Date(wh.created_at).toLocaleDateString()}
                </p>
              </div>
              <button
                onClick={() => handleDelete(wh.id)}
                className="shrink-0 text-xs text-red-400 hover:text-red-300 transition"
              >
                Delete
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
