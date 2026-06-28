export const dynamic = "force-dynamic";

import { Hero } from "@/components/Hero";
import { RouteSearch } from "@/components/RouteSearch";
import { supabase } from "@/lib/supabase";

type Bank = {
  id: string;
  name: string;
  website: string | null;
};

export default async function Home() {
  const { data: banks, error } = await supabase
    .from("banks")
    .select("id, name, website")
    .order("name", { ascending: true });

  const bankOptions = (banks ?? []) as Bank[];

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center px-6 pt-6 pb-16">
        
        <Hero />

        <div id="search" className="mt-8 w-full max-w-4xl">
          {error ? (
            <p className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-red-200">
              Supabase error: {error.message}
            </p>
          ) : (
            <RouteSearch banks={bankOptions} />
          )}
        </div>

        {/* HOW IT WORKS SECTION */}
        <section
          id="how-it-works"
          className="mx-auto mt-16 w-full max-w-4xl px-6 text-center"
        >
          <h2 className="text-2xl font-semibold text-white">
            How it works
          </h2>

          <div className="mt-8 grid gap-6 md:grid-cols-3 text-left">
            
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
              <h3 className="font-semibold text-white">1. Select banks</h3>
              <p className="mt-2 text-sm text-slate-400">
                Choose a sending bank and a receiving bank.
              </p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
              <h3 className="font-semibold text-white">2. We analyze routes</h3>
              <p className="mt-2 text-sm text-slate-400">
                We check available transfer rails like ACH, RTP, FedNow, and wire.
              </p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
              <h3 className="font-semibold text-white">3. See results</h3>
              <p className="mt-2 text-sm text-slate-400">
                You get a simple breakdown of how money moves between banks.
              </p>
            </div>

          </div>
        </section>

      </div>
    </main>
  );
}