import { supabase } from "@/lib/supabase";

export default async function Home() {
  const { data: banks, error } = await supabase
    .from("banks")
    .select("id, name, website")
    .order("name", { ascending: true });

  return (
    <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
      <div className="w-full max-w-3xl px-6 text-center">
        <p className="mb-4 text-sm font-semibold uppercase tracking-[0.3em] text-blue-400">
          InstantRailCheck
        </p>

        <h1 className="mb-4 text-5xl font-bold tracking-tight md:text-6xl">
          Know before you transfer.
        </h1>

        <p className="mx-auto mb-10 max-w-2xl text-lg text-slate-300">
          Search real-world bank transfer compatibility across RTP, FedNow,
          ACH, wire, and more.
        </p>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 text-left shadow-2xl">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="text-xl font-semibold">Banks in the database</h2>
            <span className="rounded-full bg-blue-500/10 px-3 py-1 text-sm text-blue-300">
              Live from Supabase
            </span>
          </div>

          {error ? (
            <p className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-red-200">
              Supabase error: {error.message}
            </p>
          ) : banks && banks.length > 0 ? (
            <ul className="space-y-3">
              {banks.map((bank) => (
                <li
                  key={bank.id}
                  className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950 px-4 py-3"
                >
                  <span className="font-medium">{bank.name}</span>
                  {bank.website ? (
                    <a
                      href={bank.website}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm text-blue-300 hover:text-blue-200"
                    >
                      Website
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-xl border border-slate-800 bg-slate-950 p-4 text-slate-300">
              No banks found yet.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}