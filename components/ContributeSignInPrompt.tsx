"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AuthModal } from "@/components/AuthModal";
import type { User } from "@supabase/supabase-js";

// Rendered only when the server already determined the visitor is signed
// out (app/contribute/page.tsx checks this itself, server-side). Tracks
// auth state client-side just long enough to notice a sign-in and hand off
// to the server — once signed in, router.refresh() re-fetches the page so
// the real private summary (server-fetched, scoped to that user) replaces
// this prompt, rather than this component trying to fetch or render any
// of that data itself.
export function ContributeSignInPrompt() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [authOpen, setAuthOpen] = useState(false);

  useEffect(() => {
    const supabase = createClient();

    supabase.auth.getUser().then(({ data }) => setUser(data.user));

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_, session) => setUser(session?.user ?? null));

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (user) router.refresh();
  }, [user, router]);

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 text-center">
      <AuthModal open={authOpen} onOpenChange={setAuthOpen} />
      <p className="text-slate-400">Sign in to see your contribution summary.</p>
      <button
        onClick={() => setAuthOpen(true)}
        className="mt-4 rounded-xl bg-blue-600 px-6 py-3 font-semibold text-white transition hover:bg-blue-500"
      >
        Sign in
      </button>
    </div>
  );
}
