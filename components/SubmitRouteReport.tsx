"use client";

import { useEffect, useState } from "react";
import { BankSelect } from "@/components/BankSelect";
import { AuthModal } from "@/components/AuthModal";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";

type Bank = {
  id: string;
  name: string;
};

type Props = {
  banks: Bank[];
};

function today() {
  return new Date().toISOString().split("T")[0];
}

export function SubmitRouteReport({ banks }: Props) {
  const [user, setUser] = useState<User | null>(null);
  const [allBanks, setAllBanks] = useState<Bank[]>(banks);
  const [authOpen, setAuthOpen] = useState(false);
  const [fromBankId, setFromBankId] = useState("");
  const [toBankId, setToBankId] = useState("");
  const [railUsed, setRailUsed] = useState("");
  const [direction, setDirection] = useState("");
  const [status, setStatus] = useState("");
  const [testedAt, setTestedAt] = useState(today());
  const [settlementTime, setSettlementTime] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();

    supabase.auth.getUser().then(({ data }) => setUser(data.user));

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_, session) => setUser(session?.user ?? null)
    );

    return () => subscription.unsubscribe();
  }, []);

  async function handleAddBank(name: string): Promise<string> {
    const supabase = createClient();
    const { data: existing } = await supabase
      .from("banks")
      .select("id, name")
      .ilike("name", name.trim())
      .maybeSingle();

    if (existing) {
      if (!allBanks.find((b) => b.id === existing.id)) {
        setAllBanks((prev) => [...prev, existing]);
      }
      return existing.id;
    }

    const { data, error } = await supabase
      .from("banks")
      .insert({ name: name.trim() })
      .select("id, name")
      .single();

    if (error) throw error;
    setAllBanks((prev) => [...prev, data]);
    return data.id;
  }

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
      if (!fromBankId || !toBankId || !railUsed || !direction || !status) {
        throw new Error("Please fill in all required fields");
      }

      const fromBank = allBanks.find((b) => b.id === fromBankId);
      const toBank = allBanks.find((b) => b.id === toBankId);

      if (!fromBank || !toBank) throw new Error("Selected bank not found");

      const supabase = createClient();
      const { error: insertError } = await supabase
        .from("route_reports")
        .insert({
          from_bank_id: fromBank.id,
          to_bank_id: toBank.id,
          from_bank_name: fromBank.name,
          to_bank_name: toBank.name,
          rail_used: railUsed,
          direction,
          status,
          tested_at: testedAt,
          settlement_time_minutes: settlementTime ? parseInt(settlementTime) : null,
          notes,
          user_id: user.id,
        });

      if (insertError) throw insertError;

      setFromBankId("");
      setToBankId("");
      setRailUsed("");
      setDirection("");
      setStatus("");
      setTestedAt(today());
      setSettlementTime("");
      setNotes("");
      setSuccess(true);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Submit failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <AuthModal open={authOpen} onOpenChange={setAuthOpen} />

      <div className="mt-10 rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold">Submit Route Report</h2>
            <p className="text-sm text-slate-400">
              Add real transfer outcomes to improve routing intelligence.
            </p>
          </div>
          {user && (
            <div className="text-right">
              <p className="text-xs text-slate-500">{user.email}</p>
              <button
                onClick={handleSignOut}
                className="text-xs text-slate-400 hover:text-white transition"
              >
                Sign out
              </button>
            </div>
          )}
        </div>

        {!user ? (
          <div className="mt-6 rounded-xl border border-slate-700 bg-slate-950 p-6 text-center">
            <p className="text-slate-400">Sign in to submit a route report.</p>
            <button
              onClick={() => setAuthOpen(true)}
              className="mt-4 rounded-xl bg-blue-600 px-6 py-3 font-semibold text-white transition hover:bg-blue-500"
            >
              Sign in
            </button>
          </div>
        ) : (
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <BankSelect
              label="From bank"
              placeholder="Sender bank"
              banks={allBanks}
              value={fromBankId}
              onChange={setFromBankId}
              onAdd={handleAddBank}
            />

            <BankSelect
              label="To bank"
              placeholder="Receiver bank"
              banks={allBanks}
              value={toBankId}
              onChange={setToBankId}
              onAdd={handleAddBank}
            />

            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-slate-300">Rail used</label>
              <select
                value={railUsed}
                onChange={(e) => setRailUsed(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-950 p-3 text-white"
              >
                <option value="">Select rail</option>
                <option value="RTP">RTP</option>
                <option value="FedNow">FedNow</option>
                <option value="ACH">ACH</option>
                <option value="Wire">Wire</option>
                <option value="Zelle">Zelle</option>
                <option value="Other">Other</option>
                <option value="Unknown">Unknown</option>
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-slate-300">Direction</label>
              <select
                value={direction}
                onChange={(e) => setDirection(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-950 p-3 text-white"
              >
                <option value="">Select direction</option>
                <option value="push">Push (I sent money out)</option>
                <option value="pull">Pull (money was pulled in)</option>
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-slate-300">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-950 p-3 text-white"
              >
                <option value="">Select status</option>
                <option value="success">Success</option>
                <option value="failed">Failed</option>
                <option value="delayed">Delayed</option>
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-slate-300">Date tested</label>
              <input
                type="date"
                value={testedAt}
                max={today()}
                onChange={(e) => setTestedAt(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-950 p-3 text-white"
              />
            </div>

            <input
              value={settlementTime}
              onChange={(e) => setSettlementTime(e.target.value)}
              placeholder="Settlement time (minutes, optional)"
              type="number"
              min="0"
              className="rounded-lg border border-slate-700 bg-slate-950 p-3 text-white md:col-span-2"
            />

            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notes (optional)"
              className="rounded-lg border border-slate-700 bg-slate-950 p-3 text-white md:col-span-2"
              rows={3}
            />

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
    </>
  );
}
