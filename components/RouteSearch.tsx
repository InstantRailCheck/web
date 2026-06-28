"use client";

import { useMemo, useState } from "react";
import { BankSelect } from "@/components/BankSelect";

type Bank = {
  id: string;
  name: string;
};

type RouteSearchProps = {
  banks: Bank[];
};

export function RouteSearch({ banks }: RouteSearchProps) {
  const [fromBankId, setFromBankId] = useState("");
  const [toBankId, setToBankId] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkedRoute, setCheckedRoute] = useState<{
    fromBankName: string;
    toBankName: string;
  } | null>(null);

  const fromBank = useMemo(
    () => banks.find((bank) => bank.id === fromBankId),
    [banks, fromBankId]
  );

  const toBank = useMemo(
    () => banks.find((bank) => bank.id === toBankId),
    [banks, toBankId]
  );

  function handleCheckRoute() {
    if (!fromBank || !toBank || fromBank.id === toBank.id) {
      setCheckedRoute(null);
      return;
    }

    setLoading(true);
    setCheckedRoute(null);

    setTimeout(() => {
      setCheckedRoute({
        fromBankName: fromBank.name,
        toBankName: toBank.name,
      });
      setLoading(false);
    }, 800);
  }

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 text-left shadow-2xl">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Check a transfer route</h2>
          <p className="mt-1 text-sm text-slate-400">
            Choose a sending bank and receiving bank.
          </p>
        </div>
      </div>

      <form className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <BankSelect
          label="From bank"
          placeholder="Search sender"
          banks={banks}
          value={fromBankId}
          onChange={setFromBankId}
        />

        <BankSelect
          label="To bank"
          placeholder="Search receiver"
          banks={banks}
          value={toBankId}
          onChange={setToBankId}
        />

        <button
          type="button"
          onClick={handleCheckRoute}
          className="rounded-xl bg-blue-600 px-6 py-3 font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!fromBankId || !toBankId || fromBankId === toBankId}
        >
          Check Route
        </button>
      </form>

      <p className="mt-5 text-sm text-slate-500">
        {banks.length} banks currently available.
      </p>

      {fromBankId && toBankId && fromBankId === toBankId ? (
        <p className="mt-4 rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-4 text-sm text-yellow-200">
          Choose two different banks to check a route.
        </p>
      ) : null}

      {loading ? (
        <div className="mt-6 rounded-xl border border-slate-800 bg-slate-950 p-5">
          <p className="text-sm uppercase tracking-[0.3em] text-blue-400">
            Analyzing Routes
          </p>

          <div className="mt-4 space-y-2">
            <div className="h-2 w-full animate-pulse rounded bg-slate-800" />
            <div className="h-2 w-3/4 animate-pulse rounded bg-slate-800" />
            <div className="h-2 w-1/2 animate-pulse rounded bg-slate-800" />
          </div>

          <p className="mt-4 text-sm text-slate-500">
            Checking RTP, ACH, FedNow, and wire availability...
          </p>
        </div>
      ) : null}

      {checkedRoute ? (
        <div className="mt-6 animate-fade-in rounded-xl border border-slate-800 bg-slate-950 p-5 space-y-6">

          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-blue-400">
              Route Intelligence Report
            </p>

            <h3 className="mt-2 text-2xl font-semibold">
              {checkedRoute.fromBankName} → {checkedRoute.toBankName}
            </h3>
          </div>

          <div className="space-y-3">
            <p className="text-xs uppercase tracking-wider text-slate-500">
              Primary Rails (Instant Settlement)
            </p>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-3 text-green-300">
                ⚡ RTP: Available (Instant eligible)
              </div>

              <div className="rounded-lg border border-purple-500/30 bg-purple-500/10 p-3 text-purple-300">
                🏦 FedNow: Limited coverage
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-xs uppercase tracking-wider text-slate-500">
              Fallback Rails
            </p>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 text-blue-300">
                ACH: Universal settlement (1–2 days)
              </div>

              <div className="rounded-lg border border-slate-800 bg-slate-900 p-3 text-slate-300">
                Wire: High-value fallback supported
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-400">
            This route supports instant transfers primarily through RTP.
            FedNow coverage is partial on this corridor, meaning instant settlement may vary by routing path.
            ACH serves as the universal fallback rail when instant rails are unavailable.
          </div>

          <div className="text-xs uppercase tracking-wider text-blue-400">
            Instant Capability: HIGH (RTP supported)
          </div>

        </div>
      ) : null}

    </div>
  );
}