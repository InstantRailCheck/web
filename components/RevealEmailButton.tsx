"use client";

import { useState } from "react";
import { revealUserEmail } from "@/lib/actions/revealUserEmail";

type Props = { targetUserId: string; masked: string };

// Email is masked by default; revealing it is a separate, audited action
// (see lib/actions/revealUserEmail.ts) — the friction is the masking, not
// the reveal itself, so this is a single click with no confirm step.
export function RevealEmailButton({ targetUserId, masked }: Props) {
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleReveal() {
    setLoading(true);
    setError(null);
    const result = await revealUserEmail(targetUserId);
    setLoading(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setEmail(result.email);
  }

  if (email) {
    return <p className="text-sm text-white">{email}</p>;
  }

  return (
    <div className="flex items-center gap-2">
      <p className="text-sm text-white">{masked}</p>
      <button
        type="button"
        onClick={handleReveal}
        disabled={loading}
        className="rounded-full border border-slate-700 px-2.5 py-1 text-xs font-medium text-slate-300 transition hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? "Revealing..." : "Reveal email"}
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}
