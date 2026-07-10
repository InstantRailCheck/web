"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BankSelect } from "@/components/BankSelect";

type Bank = {
  id: string;
  slug: string;
  name: string;
};

type Props = {
  banks: Bank[];
  initialSlugs: string[];
};

export function ComparePicker({ banks, initialSlugs }: Props) {
  const router = useRouter();
  const findIdBySlug = (slug: string | undefined) => banks.find((b) => b.slug === slug)?.id ?? "";

  const [aId, setAId] = useState(findIdBySlug(initialSlugs[0]));
  const [bId, setBId] = useState(findIdBySlug(initialSlugs[1]));

  function handleCompare() {
    if (!aId || !bId || aId === bId) return;
    const aSlug = banks.find((b) => b.id === aId)?.slug;
    const bSlug = banks.find((b) => b.id === bId)?.slug;
    if (!aSlug || !bSlug) return;
    router.push(`/compare?banks=${aSlug},${bSlug}`);
  }

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
      <div className="mx-auto grid max-w-3xl gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <BankSelect label="First bank" placeholder="Select a bank" banks={banks} value={aId} onChange={setAId} centerLabel centerText />
        <BankSelect label="Second bank" placeholder="Select a bank" banks={banks} value={bId} onChange={setBId} centerLabel centerText />
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
