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
    <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
      <div className="w-full max-w-4xl px-6 py-16 text-center">
        <Hero />

        {error ? (
          <p className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-left text-red-200">
            Supabase error: {error.message}
          </p>
        ) : (
          <RouteSearch banks={bankOptions} />
        )}
      </div>
    </main>
  );
}