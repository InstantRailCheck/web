"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AuthModal } from "@/components/AuthModal";
import { submitCorrection, type CorrectionField, type CorrectionResult } from "@/lib/actions/submitCorrection";
import type { User } from "@supabase/supabase-js";

type Props = {
  bankId: string;
};

export function SuggestCorrection({ bankId }: Props) {
  const [user, setUser] = useState<User | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const [field, setField] = useState<CorrectionField>("website");
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CorrectionResult | null>(null);

  useEffect(() => {
    const supabase = createClient();

    supabase.auth.getUser().then(({ data }) => setUser(data.user));

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_, session) => setUser(session?.user ?? null));

    return () => subscription.unsubscribe();
  }, []);

  async function handleSubmit() {
    if (!user) {
      setAuthOpen(true);
      return;
    }

    setLoading(true);
    setResult(null);
    try {
      const res = await submitCorrection(bankId, field, value);
      setResult(res);
      if (res.status !== "error") {
        setValue("");
      }
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <>
        <AuthModal open={authOpen} onOpenChange={setAuthOpen} />
        <button
          onClick={() => setOpen(true)}
          className="mt-3 text-xs text-slate-500 hover:text-slate-300 transition"
        >
          Something wrong? Suggest a correction
        </button>
      </>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-slate-800 bg-slate-900/70 p-4">
      <AuthModal open={authOpen} onOpenChange={setAuthOpen} />
      <p className="text-xs text-slate-400">
        Suggestions are checked against official sources before being applied. If it doesn't
        match, it's flagged for review instead of applied automatically.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <select
          value={field}
          onChange={(e) => setField(e.target.value as CorrectionField)}
          className="rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm text-white"
        >
          <option value="website">Website</option>
          <option value="phone">Phone</option>
        </select>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={field === "website" ? "https://example.com" : "(555) 555-5555"}
          className="min-w-[180px] flex-1 rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm text-white placeholder-slate-500"
        />
        <button
          onClick={handleSubmit}
          disabled={!value.trim() || loading}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Checking..." : "Submit"}
        </button>
      </div>

      {result && (
        <p
          className={`mt-3 text-sm ${
            result.status === "auto_applied"
              ? "text-green-400"
              : result.status === "pending_review"
                ? "text-yellow-400"
                : "text-red-400"
          }`}
        >
          {result.message}
        </p>
      )}
    </div>
  );
}
