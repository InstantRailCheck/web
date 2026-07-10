"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BankSelect, type Bank } from "@/components/BankSelect";

type Props = {
  initialBankA: Bank | null;
  initialBankB: Bank | null;
};

export function ComparePicker({ initialBankA, initialBankB }: Props) {
  const router = useRouter();
  const [bankA, setBankA] = useState(initialBankA);
  const [bankB, setBankB] = useState(initialBankB);

  function handleCompare() {
    if (!bankA || !bankB || bankA.id === bankB.id) return;
    router.push(`/compare?banks=${bankA.slug},${bankB.slug}`);
  }

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
      <div className="mx-auto grid max-w-3xl gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <BankSelect label="First bank" placeholder="Select a bank" initialBank={initialBankA} onChange={setBankA} centerLabel centerText />
        <BankSelect label="Second bank" placeholder="Select a bank" initialBank={initialBankB} onChange={setBankB} centerLabel centerText />
        <button
          type="button"
          onClick={handleCompare}
          disabled={!bankA || !bankB || bankA.id === bankB.id}
          className="rounded-xl bg-blue-600 px-6 py-3 font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Compare
        </button>
      </div>
      {bankA && bankB && bankA.id === bankB.id && (
        <p className="mt-4 text-sm text-yellow-200">Choose two different banks to compare.</p>
      )}
    </div>
  );
}
