"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BankSelect, type Bank } from "@/components/BankSelect";
import { AuthModal } from "@/components/AuthModal";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
              <div className="flex flex-col items-center gap-2 md:col-span-2">
                <span className="text-sm font-medium text-slate-300">
                  In this transfer, was {fixedBank.name} the sender or the receiver?
                </span>
                <div className="flex gap-2">
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
                    Sender
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
                    Receiver
                  </button>
                </div>
              </div>
            )}

            {fixedBank && fixedRole === "from" ? (
              <div className="block">
                <span className="mb-2 block text-center text-sm font-medium text-slate-300">From bank</span>
                <div className="flex w-full items-center justify-center rounded-xl border border-slate-700 bg-slate-900 px-4 py-6 text-center text-slate-300">
                  {fixedBank.name}
                </div>
              </div>
            ) : (
              <BankSelect
                label="From bank"
                placeholder="Sender bank"
                onChange={setFromBank}
                onAdd={handleAddBank}
                centerLabel
                centerText
              />
            )}

            {fixedBank && fixedRole === "to" ? (
              <div className="block">
                <span className="mb-2 block text-center text-sm font-medium text-slate-300">To bank</span>
                <div className="flex w-full items-center justify-center rounded-xl border border-slate-700 bg-slate-900 px-4 py-6 text-center text-slate-300">
                  {fixedBank.name}
                </div>
              </div>
            ) : (
              <BankSelect
                label="To bank"
                placeholder="Receiver bank"
                onChange={setToBank}
                onAdd={handleAddBank}
                centerLabel
                centerText
              />
            )}

            <div className="flex flex-col items-center gap-1">
              <label className="text-center text-sm font-medium text-slate-300">Rail used</label>
              <Select value={railUsed} onValueChange={setRailUsed}>
                <SelectTrigger className="w-full justify-center rounded-xl border-slate-700 bg-slate-950 px-4 py-6 font-medium text-white">
                  <SelectValue placeholder="Select rail" />
                </SelectTrigger>
                <SelectContent className="border-slate-800 bg-slate-950 text-white">
                  <SelectItem value="RTP" className="text-white focus:bg-slate-800 focus:text-white">RTP</SelectItem>
                  <SelectItem value="FedNow" className="text-white focus:bg-slate-800 focus:text-white">FedNow</SelectItem>
                  <SelectItem value="ACH" className="text-white focus:bg-slate-800 focus:text-white">ACH</SelectItem>
                  <SelectItem value="Wire" className="text-white focus:bg-slate-800 focus:text-white">Wire</SelectItem>
                  <SelectItem value="Zelle" className="text-white focus:bg-slate-800 focus:text-white">Zelle</SelectItem>
                  <SelectItem value="Visa Direct" className="text-white focus:bg-slate-800 focus:text-white">Visa Direct</SelectItem>
                  <SelectItem value="Mastercard Send" className="text-white focus:bg-slate-800 focus:text-white">Mastercard Send</SelectItem>
                  <SelectItem value="Other" className="text-white focus:bg-slate-800 focus:text-white">Other</SelectItem>
                  <SelectItem value="Unknown" className="text-white focus:bg-slate-800 focus:text-white">Unknown</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col items-center gap-1">
              <label className="text-center text-sm font-medium text-slate-300">Direction</label>
              <Select value={direction} onValueChange={setDirection}>
                <SelectTrigger className="w-full justify-center rounded-xl border-slate-700 bg-slate-950 px-4 py-6 font-medium text-white">
                  <SelectValue placeholder="Select direction" />
                </SelectTrigger>
                <SelectContent className="border-slate-800 bg-slate-950 text-white">
                  <SelectItem value="push" className="text-white focus:bg-slate-800 focus:text-white">Push (I sent money out)</SelectItem>
                  <SelectItem value="pull" className="text-white focus:bg-slate-800 focus:text-white">Pull (money was pulled in)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col items-center gap-1">
              <label className="text-center text-sm font-medium text-slate-300">Status</label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-full justify-center rounded-xl border-slate-700 bg-slate-950 px-4 py-6 font-medium text-white">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent className="border-slate-800 bg-slate-950 text-white">
                  <SelectItem value="success" className="text-white focus:bg-slate-800 focus:text-white">Success</SelectItem>
                  <SelectItem value="failed" className="text-white focus:bg-slate-800 focus:text-white">Failed</SelectItem>
                  <SelectItem value="delayed" className="text-white focus:bg-slate-800 focus:text-white">Delayed</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col items-center gap-1">
              <label className="text-center text-sm font-medium text-slate-300">Date tested</label>
              <input
                type="date"
                value={testedAt}
                max={today()}
                onChange={(e) => setTestedAt(e.target.value)}
                className="w-full flex-1 rounded-xl border border-slate-700 bg-slate-950 px-4 py-2 text-center text-white"
              />
            </div>

            <input
              value={settlementTime}
              onChange={(e) => setSettlementTime(e.target.value)}
              placeholder="Settlement time (minutes, optional)"
              type="number"
              min="0"
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-6 text-center text-white md:col-span-2"
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
              className="rounded-xl border border-slate-700 bg-slate-950 p-3 text-center text-white md:col-span-2"
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
