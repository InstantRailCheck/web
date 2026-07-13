"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { requestRoute } from "@/lib/actions/requestRoute";
import { AuthModal } from "@/components/AuthModal";
import { cn } from "@/lib/utils";
import type { User } from "@supabase/supabase-js";

type Props = {
  fromBankId: string;
  toBankId: string;
  className?: string;
};

// A request is a demand signal ("please someone check this"), never
// transfer evidence — deliberately distinct wording and action from
// SubmitRouteReport's "Report this route," which is about having actually
// tried the transfer yourself.
export function RequestRouteButton({ fromBankId, toBankId, className }: Props) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [requested, setRequested] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();

    supabase.auth.getUser().then(({ data }) => setUser(data.user));

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_, session) => setUser(session?.user ?? null));

    return () => subscription.unsubscribe();
  }, []);

  async function handleClick() {
    if (!user) {
      setAuthOpen(true);
      return;
    }

    setLoading(true);
    setError(null);

    const result = await requestRoute(fromBankId, toBankId);

    setLoading(false);

    if ("error" in result) {
      setError(result.error);
      return;
    }

    setRequested(true);
    router.refresh();
  }

  if (requested) {
    return <span className={cn("shrink-0 text-xs text-blue-300/80", className)}>Requested ✓</span>;
  }

  return (
    <div className={cn("flex shrink-0 flex-col items-end gap-1", className)}>
      <AuthModal open={authOpen} onOpenChange={setAuthOpen} />
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className="shrink-0 rounded-full border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-blue-500/40 hover:text-white disabled:opacity-50"
      >
        {loading ? "Requesting..." : "Request this route"}
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
