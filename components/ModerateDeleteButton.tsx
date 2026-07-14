"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  moderateDelete,
  MODERATION_REASON_CATEGORIES,
  type ModerationTargetTable,
  type ModerationReasonCategory,
} from "@/lib/actions/moderateDelete";

const REASON_LABELS: Record<ModerationReasonCategory, string> = {
  spam: "Spam",
  fabricated: "Fabricated / never happened",
  duplicate: "Duplicate",
  privacy: "Privacy request",
  other: "Other",
};

type Props = {
  targetTable: ModerationTargetTable;
  targetId: string;
};

// Same auth-gated-action confirm shape as components/DeleteAccount.tsx,
// minus the sign-in prompt — this page is already admin-only
// (app/admin/moderation/page.tsx calls requireAdmin() before rendering
// anything, including this component).
export function ModerateDeleteButton({ targetTable, targetId }: Props) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [reasonCategory, setReasonCategory] = useState<ModerationReasonCategory>("spam");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removed, setRemoved] = useState(false);

  async function handleConfirm() {
    setLoading(true);
    setError(null);

    const result = await moderateDelete(targetTable, targetId, reason, reasonCategory);

    setLoading(false);

    if ("error" in result) {
      setError(result.error);
      return;
    }

    setRemoved(true);
    router.refresh();
  }

  if (removed) {
    return <span className="shrink-0 text-xs text-slate-500">Removed</span>;
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="shrink-0 rounded-full border border-red-900/60 px-3 py-1.5 text-xs font-medium text-red-300 transition hover:border-red-500/60 hover:bg-red-950/30"
      >
        Remove
      </button>
    );
  }

  return (
    <div className="w-full max-w-sm shrink-0 space-y-2 rounded-xl border border-red-900/50 bg-slate-950 p-3">
      <label className="block text-xs font-medium text-slate-300">
        Reason category
        <select
          value={reasonCategory}
          onChange={(e) => setReasonCategory(e.target.value as ModerationReasonCategory)}
          disabled={loading}
          className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-white"
        >
          {MODERATION_REASON_CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>
              {REASON_LABELS[cat]}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-xs font-medium text-slate-300">
        Reason (required)
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={loading}
          maxLength={500}
          rows={2}
          className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-white"
        />
      </label>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleConfirm}
          disabled={loading || reason.trim().length === 0}
          className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Removing..." : "Confirm remove"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
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
