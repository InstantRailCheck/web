"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BankSelect, type Bank } from "@/components/BankSelect";
import { AuthModal } from "@/components/AuthModal";
import { createClient } from "@/lib/supabase/client";
import { addBank } from "@/lib/actions/addBank";
import { cn } from "@/lib/utils";
import type { User } from "@supabase/supabase-js";

type Props =
  | { bankId?: undefined; bankName?: undefined }
  | { bankId: string; bankName: string };

function today() {
  return new Date().toISOString().split("T")[0];
}

export function SubmitRouteReport(props: Props) {
  const fixedBank: Bank | null = props.bankId ? { id: props.bankId, slug: "", name: props.bankName } : null;

  const [user, setUser] = useState<User | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [fixedRole, setFixedRole] = useState<"from" | "to">("from");
  const [fromBank, setFromBank] = useState<Bank | null>(fixedBank && fixedRole === "from" ? fixedBank : null);
  const [toBank, setToBank] = useState<Bank | null>(fixedBank && fixedRole === "to" ? fixedBank : null);
  const [railUsed, setRailUsed] = useState("");
  const [direction, setDirection] = useState("");
  const [status, setStatus] = useState("");
  const [testedAt, setTestedAt] = useState(today());
  const [settlementTime, setSettlementTime] = useState("");
  const [sameDay, setSameDay] = useState(false);
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

  function handleRoleToggle(role: "from" | "to") {
    if (!fixedBank || role === fixedRole) return;
    setFixedRole(role);
    if (role === "from") {
      setFromBank(fixedBank);
      setToBank((prev) => (prev?.id === fixedBank.id ? null : prev));
    } else {
      setToBank(fixedBank);
      setFromBank((prev) => (prev?.id === fixedBank.id ? null : prev));
    }
  }

  async function handleAddBank(name: string): Promise<Bank> {
    const result = await addBank(name);
    if ("error" in result) throw new Error(result.error);
    return result;
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
      if (!fromBank || !toBank || !railUsed || !direction || !status) {
        throw new Error("Please fill in all required fields");
      }

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
          same_day: railUsed === "ACH" ? sameDay : null,
          notes,
          user_id: user.id,
        });

      if (insertError) throw insertError;

      // On a bank-scoped page, keep the fixed side pinned so reporting
      // several routes for the same bank in a row doesn't require
      // re-selecting it each time — only the searched side resets.
      if (fixedBank) {
        if (fixedRole === "from") setToBank(null);
        else setFromBank(null);
      } else {
        setFromBank(null);
        setToBank(null);
      }
      setRailUsed("");
      setDirection("");
      setStatus("");
      setTestedAt(today());
      setSettlementTime("");
      setSameDay(false);
      setNotes("");
      setSuccess(true);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Submit failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <AuthModal open={authOpen} onOpenChange={setAuthOpen} />

      <div className="mt-10 rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
        <div className="relative">
          <div className="text-center">
            <h2 className="text-xl font-semibold">Submit Route Report</h2>
            <p className="text-sm text-slate-400">
              {fixedBank
                ? `Add a real transfer outcome involving ${fixedBank.name}.`
                : "Add real transfer outcomes to improve routing intelligence."}
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
            {fixedBank && (
              <div className="flex justify-center gap-2 md:col-span-2">
                <button
                  type="button"
                  onClick={() => handleRoleToggle("from")}
                  className={cn(
                    "rounded-full border px-4 py-1.5 text-sm font-medium transition",
                    fixedRole === "from"
                      ? "border-blue-500 bg-blue-500/10 text-blue-300"
                      : "border-slate-700 text-slate-400 hover:border-slate-600"
                  )}
                >
                  {fixedBank.name} is sending
                </button>
                <button
                  type="button"
                  onClick={() => handleRoleToggle("to")}
                  className={cn(
                    "rounded-full border px-4 py-1.5 text-sm font-medium transition",
                    fixedRole === "to"
                      ? "border-blue-500 bg-blue-500/10 text-blue-300"
                      : "border-slate-700 text-slate-400 hover:border-slate-600"
                  )}
                >
                  {fixedBank.name} is receiving
                </button>
              </div>
            )}

            {fixedBank && fixedRole === "from" ? (
              <div className="block">
                <span className="mb-2 block text-sm font-medium text-slate-300">From bank</span>
                <div className="flex w-full items-center rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-slate-300">
                  {fixedBank.name}
                </div>
              </div>
            ) : (
              <BankSelect
                label="From bank"
                placeholder="Sender bank"
                onChange={setFromBank}
                onAdd={handleAddBank}
              />
            )}

            {fixedBank && fixedRole === "to" ? (
              <div className="block">
                <span className="mb-2 block text-sm font-medium text-slate-300">To bank</span>
                <div className="flex w-full items-center rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-slate-300">
                  {fixedBank.name}
                </div>
              </div>
            ) : (
              <BankSelect
                label="To bank"
                placeholder="Receiver bank"
                onChange={setToBank}
                onAdd={handleAddBank}
              />
            )}

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
                <option value="Visa Direct">Visa Direct</option>
                <option value="Mastercard Send">Mastercard Send</option>
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

            {railUsed === "ACH" && (
              <label className="flex items-center gap-2 text-sm text-slate-300 md:col-span-2">
                <input
                  type="checkbox"
                  checked={sameDay}
                  onChange={(e) => setSameDay(e.target.checked)}
                  className="h-4 w-4"
                />
                This was processed as Same-Day ACH
              </label>
            )}

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
