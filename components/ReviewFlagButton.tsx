"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { reviewFlag } from "@/lib/actions/reviewFlag";
import type { Signal } from "@/lib/riskSignals";

type Props = {
  targetTable: "route_reports" | "edd_reports";
  targetId: string;
  subjectUserId: string;
  signals: Signal[];
  score: number;
};

// Marks a flag reviewed without removing content or acting on the account
// — those stay on ModerateDeleteButton / the user profile page's status
// controls. This just records that an admin looked and, optionally, why
// they're not taking further action.
export function ReviewFlagButton({ targetTable, targetId, subjectUserId, signals, score }: Props) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleConfirm() {
    setLoading(true);
    setError(null);

    const result = await reviewFlag(targetTable, targetId, subjectUserId, signals, score, note);

    setLoading(false);

    if ("error" in result) {
      setError(result.error);
      return;
    }

    setDone(true);
    router.refresh();
  }

  if (done) {
    return <span className="shrink-0 text-xs text-slate-500">Reviewed</span>;
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="shrink-0 rounded-full border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-slate-600 hover:bg-slate-800"
      >
        Mark reviewed
      </button>
    );
  }

  return (
    <div className="w-full max-w-sm shrink-0 space-y-2 rounded-xl border border-slate-700 bg-slate-950 p-3">
      <label className="block text-xs font-medium text-slate-300">
        Note (optional)
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={loading}
          maxLength={500}
          rows={2}
          placeholder="Reviewed — no action needed"
          className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-white"
        />
      </label>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleConfirm}
          disabled={loading}
          className="rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Saving..." : "Confirm reviewed"}
        </button>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          disabled={loading}
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Cancel
        </button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
