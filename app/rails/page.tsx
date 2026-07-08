import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function RailsExplorerPage() {
  const supabase = await createClient();

  const [{ data: fednow }, { data: rtp }] = await Promise.all([
    supabase.from("banks").select("id, name").eq("fednow_participant", true).order("name"),
    supabase.from("banks").select("id, name").eq("rtp_participant", true).order("name"),
  ]);

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex w-full max-w-4xl flex-col px-6 pt-10 pb-16">
        <Link href="/" className="text-sm text-slate-400 hover:text-white transition">
          ← Back to search
        </Link>

        <h1 className="mt-4 text-3xl font-bold">Payment rail explorer</h1>
        <p className="mt-1 text-sm text-slate-400">
          Banks in our database confirmed as participants on each instant payment network,
          verified against the Federal Reserve's FedNow participant list and The Clearing
          House's RTP participant list.
        </p>

        <div className="mt-8 grid gap-8 sm:grid-cols-2">
          <section>
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <span className="text-purple-400">🏦</span> FedNow
            </h2>
            <p className="mt-1 text-xs text-slate-500">{fednow?.length ?? 0} banks</p>
            <div className="mt-3 divide-y divide-slate-800 rounded-2xl border border-slate-800 bg-slate-900/70">
              {(fednow ?? []).length === 0 ? (
                <p className="px-5 py-4 text-sm text-slate-500">None confirmed yet.</p>
              ) : (
                (fednow ?? []).map((bank) => (
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

          <section>
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <span className="text-green-400">⚡</span> RTP
            </h2>
            <p className="mt-1 text-xs text-slate-500">{rtp?.length ?? 0} banks</p>
            <div className="mt-3 divide-y divide-slate-800 rounded-2xl border border-slate-800 bg-slate-900/70">
              {(rtp ?? []).length === 0 ? (
                <p className="px-5 py-4 text-sm text-slate-500">None confirmed yet.</p>
              ) : (
                (rtp ?? []).map((bank) => (
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
        </div>
      </div>
    </main>
  );
}
