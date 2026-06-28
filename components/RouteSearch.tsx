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

    setCheckedRoute({
      fromBankName: fromBank.name,
      toBankName: toBank.name,
    });
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
        <span className="rounded-full bg-blue-500/10 px-3 py-1 text-sm text-blue-300">
          Live from Supabase
        </span>
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

      {checkedRoute ? (
        <div className="mt-6 rounded-xl border border-slate-800 bg-slate-950 p-5">
          <p className="text-sm font-medium uppercase tracking-[0.25em] text-blue-400">
            Route preview
          </p>
          <h3 className="mt-2 text-2xl font-semibold">
            {checkedRoute.fromBankName} → {checkedRoute.toBankName}
          </h3>
          <p className="mt-3 text-slate-400">
            No route reports yet. Be the first to submit a real-world test.
          </p>
        </div>
      ) : null}
    </div>
  );
}