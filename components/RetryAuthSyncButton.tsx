"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { retryAuthSync } from "@/lib/actions/retryAuthSync";

type Props = { targetUserId: string; prominent: boolean; errorMessage: string | null };

// Two affordances calling the same action: `prominent` renders the
// warning banner shown when auth_sync_status = 'pending'; the non-
// prominent variant is a low-key "Re-sync Auth status" link always
// present regardless of that flag — a synced flag can itself be stale
// (see lib/authSync.ts's reconcileAuthSync), so this stays reachable even
// when nothing on the page currently signals a problem.
export function RetryAuthSyncButton({ targetUserId, prominent, errorMessage }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRetry() {
    setLoading(true);
    setError(null);
    const result = await retryAuthSync(targetUserId);
    setLoading(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  if (prominent) {
    return (
      <div className="rounded-lg border border-amber-800/60 bg-amber-950/20 px-3 py-2 text-xs text-amber-300">
        <p>Auth sync pending{errorMessage ? `: ${errorMessage}` : "."}</p>
        <button
          type="button"
          onClick={handleRetry}
          disabled={loading}
          className="mt-1 rounded-full border border-amber-700 px-2.5 py-1 text-xs font-medium text-amber-200 transition hover:border-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Retrying..." : "Retry Auth sync"}
        </button>
        {error && <p className="mt-1 text-red-400">{error}</p>}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={handleRetry}
      disabled={loading}
      className="text-xs text-slate-500 underline transition hover:text-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {loading ? "Re-syncing..." : "Re-sync Auth status"}
    </button>
  );
}
