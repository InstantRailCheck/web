"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  moderateSetUserStatus,
  USER_STATUS_REASON_CATEGORIES,
  type UserStatusValue,
  type UserStatusReasonCategory,
} from "@/lib/actions/moderateSetUserStatus";

const REASON_LABELS: Record<UserStatusReasonCategory, string> = {
  spam: "Spam",
  fabricated: "Fabricated evidence",
  duplicate: "Duplicate",
  privacy: "Privacy request",
  abuse: "Abuse",
  harassment: "Harassment",
  other: "Other",
};

const ACTIONS: { status: UserStatusValue; label: string; typedConfirm?: string }[] = [
  { status: "active", label: "Reactivate" },
  { status: "restricted", label: "Restrict" },
  { status: "temporarily_banned", label: "Temporarily suspend" },
  { status: "permanently_banned", label: "Permanently ban", typedConfirm: "BAN" },
];

type Props = { targetUserId: string };

// Mirrors ModerateDeleteButton's confirm-with-reason shape — four actions
// instead of one, plus a duration field for temporary suspension and a
// typed-confirmation gate for the one genuinely hard-to-reverse action
// here (permanent ban; every other status is freely reversible via
// Reactivate).
export function UserStatusButton({ targetUserId }: Props) {
  const router = useRouter();
  const [activeAction, setActiveAction] = useState<UserStatusValue | null>(null);
  const [reasonCategory, setReasonCategory] = useState<UserStatusReasonCategory>("spam");
  const [reason, setReason] = useState("");
  const [banHours, setBanHours] = useState("24");
  const [typedConfirm, setTypedConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const action = ACTIONS.find((a) => a.status === activeAction);

  async function handleConfirm() {
    if (!action) return;
    setLoading(true);
    setError(null);
    setWarning(null);

    const result = await moderateSetUserStatus(
      targetUserId,
      action.status,
      reason,
      reasonCategory,
      action.status === "temporarily_banned" ? Number(banHours) : undefined,
      typedConfirm
    );

    setLoading(false);

    if ("error" in result) {
      setError(result.error);
      return;
    }

    if (result.authSyncWarning) setWarning(result.authSyncWarning);
    setActiveAction(null);
    setReason("");
    setTypedConfirm("");
    router.refresh();
  }

  if (!action) {
    return (
      <div className="flex flex-wrap gap-2">
        {ACTIONS.map((a) => (
          <button
            key={a.status}
            type="button"
            onClick={() => setActiveAction(a.status)}
            className="rounded-full border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-slate-500"
          >
            {a.label}
          </button>
        ))}
        {warning && <p className="w-full text-xs text-amber-400">Auth sync warning: {warning}</p>}
      </div>
    );
  }

  const confirmDisabled =
    loading || reason.trim().length === 0 || Boolean(action.typedConfirm && typedConfirm !== action.typedConfirm);

  return (
    <div className="w-full max-w-sm space-y-2 rounded-xl border border-slate-800 bg-slate-950 p-3">
      <p className="text-sm font-medium text-white">{action.label}</p>

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

      {action.status === "temporarily_banned" && (
        <label className="block text-xs font-medium text-slate-300">
          Duration (hours, 1-8760)
          <input
            type="number"
            min={1}
            max={8760}
            value={banHours}
            onChange={(e) => setBanHours(e.target.value)}
            disabled={loading}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-white"
          />
        </label>
      )}

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

      {action.typedConfirm && (
        <label className="block text-xs font-medium text-slate-300">
          Type {action.typedConfirm} to confirm
          <input
            type="text"
            value={typedConfirm}
            onChange={(e) => setTypedConfirm(e.target.value)}
            disabled={loading}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-white"
          />
        </label>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleConfirm}
          disabled={confirmDisabled}
          className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Working..." : `Confirm ${action.label.toLowerCase()}`}
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveAction(null);
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
