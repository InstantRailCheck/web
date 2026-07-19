"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BankSelect, type Bank, type AddBankOutcome } from "@/components/BankSelect";
import { AuthModal } from "@/components/AuthModal";
import { DatePicker } from "@/components/DatePicker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import { addBank } from "@/lib/actions/addBank";
import { submitRouteReport } from "@/lib/actions/submitRouteReport";
import { cn } from "@/lib/utils";
import type { User } from "@supabase/supabase-js";

type Props =
  | { bankId: string; bankName: string }
  | {
      bankId?: undefined;
      bankName?: undefined;
      // Passed by a coordinating parent (the homepage route checker) that
      // owns fromBank/toBank itself — when present (even as null), the
      // parent is treated as the source of truth: a successful submission
      // keeps both selections instead of clearing them, and onSuccess lets
      // the parent refetch route evidence in place. Omit both entirely for
      // the old standalone behavior (both sides start empty, clear on success).
      initialFromBank?: Bank | null;
      initialToBank?: Bank | null;
      // Receives the banks actually submitted — both sides stay editable in
      // this mode, so what was submitted can differ from initialFromBank/
      // initialToBank; the parent must not assume its own prior selection.
      onSuccess?: (route: { fromBank: Bank; toBank: Bank }) => void | Promise<void>;
    };

function today() {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

export function SubmitRouteReport(props: Props) {
  const router = useRouter();
  const fixedBank: Bank | null = props.bankId ? { id: props.bankId, slug: "", name: props.bankName } : null;
  // A coordinating parent is present whenever it passed either prefill prop
  // at all (even explicitly null) — that's the signal to keep selections
  // after a successful submit instead of clearing them, and to call
  // onSuccess so the parent can refetch route evidence in place.
  let initialFromBank: Bank | null = null;
  let initialToBank: Bank | null = null;
  let onSuccessCallback: ((route: { fromBank: Bank; toBank: Bank }) => void | Promise<void>) | undefined;
  let coordinated = false;
  if (props.bankId === undefined) {
    initialFromBank = props.initialFromBank ?? null;
    initialToBank = props.initialToBank ?? null;
    onSuccessCallback = props.onSuccess;
    coordinated = props.initialFromBank !== undefined || props.initialToBank !== undefined;
  }

  const [user, setUser] = useState<User | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [fixedRole, setFixedRole] = useState<"from" | "to">("from");
  const [fromBank, setFromBank] = useState<Bank | null>(
    fixedBank && fixedRole === "from" ? fixedBank : initialFromBank
  );
  const [toBank, setToBank] = useState<Bank | null>(
    fixedBank && fixedRole === "to" ? fixedBank : initialToBank
  );
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
  // BankSelect manages its own selected-bank state internally, so clearing
  // fromBank/toBank here doesn't by itself clear what it visually shows —
  // bumping this key forces a remount of whichever side needs to reset.
  const [resetKey, setResetKey] = useState(0);
  const railLabelId = useId();
  const directionLabelId = useId();
  const statusLabelId = useId();

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

  async function handleAddBank(name: string): Promise<AddBankOutcome> {
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
      if (fromBank.id === toBank.id) {
        throw new Error("Sender and receiver banks must be different");
      }

      const result = await submitRouteReport({
        fromBankId: fromBank.id,
        toBankId: toBank.id,
        fromBankName: fromBank.name,
        toBankName: toBank.name,
        railUsed,
        direction,
        status,
        testedAt,
        settlementTimeMinutes: settlementTime ? parseInt(settlementTime) : null,
        sameDay: railUsed === "ACH" ? sameDay : null,
        notes,
      });

      if ("error" in result) throw new Error(result.error);

      // The report may have just fulfilled an active route_requests row
      // and/or changed the needs-fresh-reports list (submitRouteReport
      // already invalidated that cache) — refresh so this page reflects it
      // immediately rather than on the visitor's next navigation.
      router.refresh();

      // On a bank-scoped page, keep the fixed side pinned so reporting
      // several routes for the same bank in a row doesn't require
      // re-selecting it each time — only the searched side resets. A
      // coordinated parent (the homepage route checker) owns fromBank/
      // toBank itself and expects the checked route to stay selected, so
      // neither side resets there either.
      if (fixedBank) {
        if (fixedRole === "from") setToBank(null);
        else setFromBank(null);
        setResetKey((k) => k + 1);
      } else if (!coordinated) {
        setFromBank(null);
        setToBank(null);
        setResetKey((k) => k + 1);
      }
      setRailUsed("");
      setDirection("");
      setStatus("");
      setTestedAt(today());
      setSettlementTime("");
      setSameDay(false);
      setNotes("");
      setSuccess(true);

      if (onSuccessCallback) {
        try {
          await onSuccessCallback({ fromBank, toBank });
        } catch (err) {
          // The submission itself already succeeded — a failure in the
          // parent's follow-up (e.g. refetching route evidence) must not
          // be reported as a submit failure; the confirmation stays up.
          console.error("onSuccess handler failed after a successful submission:", err);
        }
      }
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

      <div id="submit-route-report" className="mt-10 rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
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
                    aria-pressed={fixedRole === "from"}
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
                    aria-pressed={fixedRole === "to"}
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
                key={`from-${resetKey}`}
                label="From bank"
                placeholder="Sender bank"
                initialBank={initialFromBank}
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
                key={`to-${resetKey}`}
                label="To bank"
                placeholder="Receiver bank"
                initialBank={initialToBank}
                onChange={setToBank}
                onAdd={handleAddBank}
                centerLabel
                centerText
              />
            )}

            <div className="flex flex-col items-center gap-1">
              <label id={railLabelId} className="text-center text-sm font-medium text-slate-300">Rail used</label>
              <Select value={railUsed} onValueChange={setRailUsed}>
                <SelectTrigger
                  aria-labelledby={railLabelId}
                  className="w-full justify-center rounded-xl border-slate-700 bg-slate-950 px-4 py-6 font-medium text-white data-placeholder:text-white"
                >
                  <SelectValue placeholder="Select rail" />
                </SelectTrigger>
                <SelectContent className="border-slate-800 bg-slate-950 text-white">
                  <SelectItem value="RTP" className="text-white focus:bg-slate-800 focus:text-white">RTP</SelectItem>
                  <SelectItem value="FedNow" className="text-white focus:bg-slate-800 focus:text-white">FedNow</SelectItem>
                  <SelectItem value="ACH" className="text-white focus:bg-slate-800 focus:text-white">ACH</SelectItem>
                  <SelectItem value="Wire" className="text-white focus:bg-slate-800 focus:text-white">Wire</SelectItem>
                  <SelectItem value="Zelle" className="text-white focus:bg-slate-800 focus:text-white">P2P - Zelle</SelectItem>
                  <SelectItem value="Visa Direct" className="text-white focus:bg-slate-800 focus:text-white">Visa Direct</SelectItem>
                  <SelectItem value="Mastercard Send" className="text-white focus:bg-slate-800 focus:text-white">Mastercard Send</SelectItem>
                  <SelectItem value="Other" className="text-white focus:bg-slate-800 focus:text-white">Other</SelectItem>
                  <SelectItem value="Unknown" className="text-white focus:bg-slate-800 focus:text-white">Unknown</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col items-center gap-1">
              <label id={directionLabelId} className="text-center text-sm font-medium text-slate-300">Direction</label>
              <Select value={direction} onValueChange={setDirection}>
                <SelectTrigger
                  aria-labelledby={directionLabelId}
                  className="w-full justify-center rounded-xl border-slate-700 bg-slate-950 px-4 py-6 font-medium text-white data-placeholder:text-white"
                >
                  <SelectValue placeholder="Select direction" />
                </SelectTrigger>
                <SelectContent className="border-slate-800 bg-slate-950 text-white">
                  <SelectItem value="push" className="text-white focus:bg-slate-800 focus:text-white">Push (I sent money out)</SelectItem>
                  <SelectItem value="pull" className="text-white focus:bg-slate-800 focus:text-white">Pull (money was pulled in)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col items-center gap-1">
              <label id={statusLabelId} className="text-center text-sm font-medium text-slate-300">Status</label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger
                  aria-labelledby={statusLabelId}
                  className="w-full justify-center rounded-xl border-slate-700 bg-slate-950 px-4 py-6 font-medium text-white data-placeholder:text-white"
                >
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent className="border-slate-800 bg-slate-950 text-white">
                  <SelectItem value="success" className="text-white focus:bg-slate-800 focus:text-white">Success</SelectItem>
                  <SelectItem value="failed" className="text-white focus:bg-slate-800 focus:text-white">Failed</SelectItem>
                  <SelectItem value="delayed" className="text-white focus:bg-slate-800 focus:text-white">Delayed</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <DatePicker label="Date tested" value={testedAt} onChange={setTestedAt} max={today()} centerLabel />


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
