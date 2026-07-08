"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BankSelect } from "@/components/BankSelect";

type Bank = {
  id: string;
  name: string;
};

type Props = {
  banks: Bank[];
  initialIds: string[];
};

export function ComparePicker({ banks, initialIds }: Props) {
  const router = useRouter();
  const [aId, setAId] = useState(initialIds[0] ?? "");
  const [bId, setBId] = useState(initialIds[1] ?? "");

  function handleCompare() {
    if (!aId || !bId || aId === bId) return;
    router.push(`/compare?banks=${aId},${bId}`);
  }

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
      <div className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <BankSelect label="Bank A" placeholder="Select a bank" banks={banks} value={aId} onChange={setAId} />
        <BankSelect label="Bank B" placeholder="Select a bank" banks={banks} value={bId} onChange={setBId} />
        <button
          type="button"
          onClick={handleCompare}
          disabled={!aId || !bId || aId === bId}
          className="rounded-xl bg-blue-600 px-6 py-3 font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Compare
        </button>
      </div>
      {aId && bId && aId === bId && (
        <p className="mt-4 text-sm text-yellow-200">Choose two different banks to compare.</p>
      )}
    </div>
  );
}
