import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function BanksDirectoryPage() {
  const supabase = await createClient();
  const { data: banks } = await supabase
    .from("banks")
    .select("id, name")
    .order("name", { ascending: true });

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex w-full max-w-4xl flex-col px-6 pt-10 pb-16">
        <Link href="/" className="text-sm text-slate-400 hover:text-white transition">
          ← Back to search
        </Link>

        <h1 className="mt-4 text-3xl font-bold">All banks</h1>
        <p className="mt-1 text-sm text-slate-400">
          {banks?.length ?? 0} bank{banks?.length !== 1 ? "s" : ""} in the database.
        </p>

        <div className="mt-6 grid gap-2 sm:grid-cols-2">
          {(banks ?? []).map((bank) => (
            <Link
              key={bank.id}
              href={`/banks/${bank.id}`}
              className="rounded-lg border border-slate-800 bg-slate-900/70 p-3 text-sm text-slate-200 hover:border-blue-500/40 hover:text-white transition"
            >
              {bank.name}
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
