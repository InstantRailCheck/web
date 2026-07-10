"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BankSelect } from "@/components/BankSelect";
import { AuthModal } from "@/components/AuthModal";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";

type Props =
  | { banks: true; bankId?: undefined; bankName?: undefined }
  | { banks?: undefined; bankId: string; bankName: string };

// 6 is a sentinel for "more than 5 days early" — the constraint on
// edd_reports.days_early allows 0-6, not an unbounded exact count.
const DAYS_OPTIONS = [
  { value: "0", label: "Not early / same day" },
  { value: "1", label: "1 day early" },
  { value: "2", label: "2 days early" },
  { value: "3", label: "3 days early" },
  { value: "4", label: "4 days early" },
  { value: "5", label: "5 days early" },
  { value: "6", label: "More than 5 days early" },
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

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
  }

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

      <div className="relative">
        <div className="text-center">
          <h2 className="text-xl font-semibold">Report early direct deposit</h2>
          <p className="text-sm text-slate-400">
            {props.banks
              ? "Did a paycheck or benefit show up before the scheduled date?"
              : `Did a paycheck or benefit show up early at ${props.bankName}?`}
          </p>
        </div>
        {user && (
          <div className="absolute right-0 top-0 text-right">
            <p className="text-xs text-slate-500">{user.email}</p>
            <div className="flex items-center justify-end gap-2 text-xs">
              <Link href="/account" className="text-slate-400 hover:text-white transition">
                Account
              </Link>
              <span className="text-slate-700">·</span>
              <button
                onClick={handleSignOut}
                className="text-slate-400 hover:text-white transition"
              >
                Sign out
              </button>
            </div>
          </div>
        )}
      </div>

      {!user ? (
        <div className="mt-6 rounded-xl border border-slate-700 bg-slate-950 p-6 text-center">
          <p className="text-slate-400">Sign in to report early direct deposit.</p>
          <button
            onClick={() => setAuthOpen(true)}
            className="mt-4 rounded-xl bg-blue-600 px-6 py-3 font-semibold text-white transition hover:bg-blue-500"
          >
            Sign in
          </button>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {props.banks && (
            <BankSelect
              label="Bank"
              placeholder="Select bank"
              onChange={(bank) => setBankId(bank?.id ?? "")}
            />
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
            className="rounded-xl bg-green-600 px-6 py-3 font-semibold text-white md:col-span-2 disabled:opacity-50"
          >
            {loading ? "Submitting..." : "Submit Report"}
          </button>

          {success && (
            <p className="text-sm text-green-400 md:col-span-2">
              Report submitted — thank you!
            </p>
          )}

          {error && (
            <p className="text-sm text-red-400 md:col-span-2">{error}</p>
          )}
        </div>
      )}
    </div>
  );
}
