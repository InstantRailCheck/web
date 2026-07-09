"use client";

import { useEffect, useState } from "react";
import { BankSelect } from "@/components/BankSelect";
import { AuthModal } from "@/components/AuthModal";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";

type Bank = { id: string; name: string };

type Props =
  | { banks: Bank[]; bankId?: undefined; bankName?: undefined }
  | { banks?: undefined; bankId: string; bankName: string };

const DAYS_OPTIONS = [
  { value: "0", label: "Not early / same day" },
  { value: "1", label: "1 day early" },
  { value: "2", label: "2 days early" },
];

export function SubmitEddReport(props: Props) {
  const [user, setUser] = useState<User | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [bankId, setBankId] = useState(props.bankId ?? "");
  const [daysEarly, setDaysEarly] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    setSuccess(false);
    setError(null);

    try {
      if (!bankId || daysEarly === "") {
        throw new Error("Please select a bank and how early it was");
      }

      const supabase = createClient();
      const { error: insertError } = await supabase.from("edd_reports").insert({
        bank_id: bankId,
        days_early: Number(daysEarly),
        user_id: user.id,
      });

      if (insertError) throw insertError;

      if (props.banks) setBankId("");
      setDaysEarly("");
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submit failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
      <AuthModal open={authOpen} onOpenChange={setAuthOpen} />
      <h2 className="text-lg font-semibold">Report early direct deposit</h2>
      <p className="mt-1 text-sm text-slate-400">
        {props.banks
          ? "Did a paycheck or benefit show up before the scheduled date?"
          : `Did a paycheck or benefit show up early at ${props.bankName}?`}
      </p>

      {!user ? (
        <button
          onClick={() => setAuthOpen(true)}
          className="mt-4 rounded-xl bg-blue-600 px-6 py-3 font-semibold text-white transition hover:bg-blue-500"
        >
          Sign in to report
        </button>
      ) : (
        <div className="mt-4 flex flex-wrap items-end gap-3">
          {props.banks && (
            <div className="min-w-[200px] flex-1">
              <BankSelect
                label="Bank"
                placeholder="Select bank"
                banks={props.banks}
                value={bankId}
                onChange={setBankId}
              />
            </div>
          )}

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-slate-300">How early</label>
            <select
              value={daysEarly}
              onChange={(e) => setDaysEarly(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 p-3 text-white"
            >
              <option value="">Select</option>
              {DAYS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={handleSubmit}
            disabled={loading}
            className="rounded-xl bg-green-600 px-6 py-3 font-semibold text-white disabled:opacity-50"
          >
            {loading ? "Submitting..." : "Submit"}
          </button>
        </div>
      )}

      {success && <p className="mt-3 text-sm text-green-400">Report submitted — thank you!</p>}
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
    </div>
  );
}
