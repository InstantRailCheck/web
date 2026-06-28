import { BankSelect } from "@/components/BankSelect";

type Bank = {
  id: string;
  name: string;
};

type RouteSearchProps = {
  banks: Bank[];
};

export function RouteSearch({ banks }: RouteSearchProps) {
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
        <BankSelect label="From bank" placeholder="Select sender" banks={banks} />
        <BankSelect label="To bank" placeholder="Select receiver" banks={banks} />

        <button
          type="button"
          className="rounded-xl bg-blue-600 px-6 py-3 font-semibold text-white transition hover:bg-blue-500"
        >
          Check Route
        </button>
      </form>

      <p className="mt-5 text-sm text-slate-500">
        {banks.length} banks currently available.
      </p>
    </div>
  );
}