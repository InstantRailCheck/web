import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Bank = { id: string; name: string };

function RailColumn({
  icon,
  label,
  banks,
  footnote,
}: {
  icon: string;
  label: string;
  banks: Bank[];
  footnote?: string;
}) {
  return (
    <section>
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <span>{icon}</span> {label}
      </h2>
      <p className="mt-1 text-xs text-slate-500">{banks.length} banks</p>
      {footnote && <p className="mt-1 text-xs text-yellow-500/80">{footnote}</p>}
      <div className="mt-3 divide-y divide-slate-800 rounded-2xl border border-slate-800 bg-slate-900/70">
        {banks.length === 0 ? (
          <p className="px-5 py-4 text-sm text-slate-500">None confirmed yet.</p>
        ) : (
          banks.map((bank) => (
            <Link
              key={bank.id}
              href={`/banks/${bank.id}`}
              className="block px-5 py-3 text-sm text-slate-200 hover:bg-slate-900 hover:text-white transition"
            >
              {bank.name}
            </Link>
          ))
        )}
      </div>
    </section>
  );
}

export default async function RailsExplorerPage() {
  const supabase = await createClient();

  const [{ data: fednow }, { data: rtp }, { data: zelle }] = await Promise.all([
    supabase.from("banks").select("id, name").eq("fednow_participant", true).order("name"),
    supabase.from("banks").select("id, name").eq("rtp_participant", true).order("name"),
    supabase.from("banks").select("id, name").eq("zelle_participant", true).order("name"),
  ]);

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex w-full max-w-4xl flex-col px-6 pt-10 pb-16">
        <Link href="/" className="text-sm text-slate-400 hover:text-white transition">
          ← Back to search
        </Link>

        <h1 className="mt-4 text-3xl font-bold">Payment rail explorer</h1>
        <p className="mt-1 text-sm text-slate-400">
          Banks in our database confirmed as participants on each network, verified against the
          Federal Reserve's FedNow participant list, The Clearing House's RTP participant list,
          and Zelle's partner directory.
        </p>

        <div className="mt-8 grid gap-8 sm:grid-cols-3">
          <RailColumn icon="🏦" label="FedNow" banks={fednow ?? []} />
          <RailColumn icon="⚡" label="RTP" banks={rtp ?? []} />
          <RailColumn
            icon="💸"
            label="Zelle"
            banks={zelle ?? []}
            footnote="Zelle's own directory is known to be incomplete — a missing badge doesn't confirm a bank lacks Zelle support, only that it isn't listed there."
          />
        </div>
      </div>
    </main>
  );
}
