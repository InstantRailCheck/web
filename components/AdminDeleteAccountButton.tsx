"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  moderateDeleteUserAccount,
} from "@/lib/actions/moderateDeleteUserAccount";
import { USER_STATUS_REASON_CATEGORIES, type UserStatusReasonCategory } from "@/lib/actions/moderateSetUserStatus";

const REASON_LABELS: Record<UserStatusReasonCategory, string> = {
  spam: "Spam",
  fabricated: "Fabricated evidence",
  duplicate: "Duplicate",
  privacy: "Privacy request",
  abuse: "Abuse",
  harassment: "Harassment",
  other: "Other",
};

const TYPED_CONFIRM = "DELETE";

type Props = { targetUserId: string };

// Deliberately separate from UserStatusButton — this is a distinct
// destructive workflow (account removal), not abuse-status enforcement.
// Reuses the existing anonymize-on-delete FK chain: submissions stay,
// anonymized, exactly like self-service account deletion.
export function AdminDeleteAccountButton({ targetUserId }: Props) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [reasonCategory, setReasonCategory] = useState<UserStatusReasonCategory>("other");
  const [reason, setReason] = useState("");
  const [typedConfirm, setTypedConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setLoading(true);
    setError(null);

    const result = await moderateDeleteUserAccount(targetUserId, reason, reasonCategory, typedConfirm);

    setLoading(false);

    if ("error" in result) {
      setError(result.error);
      return;
    }

    if (result.auditWarning) {
      setError(result.auditWarning);
      return;
    }

    router.refresh();
  }

  if (!confirming) {
    return (
      <div>
        <h3 className="text-sm font-semibold text-red-300">Delete account and anonymize submissions</h3>
        <p className="mt-1 text-xs text-slate-400">
          Permanently deletes this account&apos;s sign-in and passkeys. Their route reports, EDD reports, corrections,
          and route requests stay as anonymous community data — no longer linked to them — rather than being
          removed. This is a separate, non-enforcement workflow: use the status actions above for abuse enforcement.
        </p>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="mt-3 rounded-lg border border-red-800 px-4 py-2 text-sm font-semibold text-red-300 transition hover:bg-red-900/30"
        >
          Delete account
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-sm space-y-2 rounded-xl border border-red-900/50 bg-slate-950 p-3">
      <label className="block text-xs font-medium text-slate-300">
        Reason category
        <select
          value={reasonCategory}
          onChange={(e) => setReasonCategory(e.target.value as UserStatusReasonCategory)}
          disabled={loading}
          className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-white"
        >
          {USER_STATUS_REASON_CATEGORIES.map((cat) => (
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
        <span className="mt-1 block text-[11px] text-slate-500">
          Internal note — avoid including email addresses or other personal information beyond what&apos;s necessary.
        </span>
      </label>

      <label className="block text-xs font-medium text-slate-300">
        Type {TYPED_CONFIRM} to confirm
        <input
          type="text"
          value={typedConfirm}
          onChange={(e) => setTypedConfirm(e.target.value)}
          disabled={loading}
          className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-white"
        />
      </label>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleConfirm}
          disabled={loading || reason.trim().length === 0 || typedConfirm !== TYPED_CONFIRM}
          className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Deleting..." : "Confirm delete"}
        </button>
        <button
          type="button"
          onClick={() => {
            setConfirming(false);
            setError(null);
          }}
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
