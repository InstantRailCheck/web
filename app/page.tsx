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
      </div>
    </main>
  );
}