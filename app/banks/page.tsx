import Link from "next/link";
import { Banknote } from "lucide-react";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

function buildPageUrl(params: Record<string, string | undefined>, page: number) {
  const usp = new URLSearchParams();
  if (params.q) usp.set("q", params.q);
  if (params.fednow) usp.set("fednow", params.fednow);
  if (params.rtp) usp.set("rtp", params.rtp);
  if (params.zelle) usp.set("zelle", params.zelle);
  if (page > 1) usp.set("page", String(page));
  const qs = usp.toString();
  return qs ? `/banks?${qs}` : "/banks";
}

export default async function BanksDirectoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; fednow?: string; rtp?: string; zelle?: string; page?: string }>;
}) {
  const { q, fednow, rtp, zelle, page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);

  const supabase = await createClient();
  let query = supabase
    .from("banks")
    .select("id, slug, name, fednow_participant, rtp_participant, zelle_participant", { count: "exact" })
    .order("name", { ascending: true });

  if (q) query = query.ilike("name", `%${q}%`);
  if (fednow === "true") query = query.eq("fednow_participant", true);
  if (rtp === "true") query = query.eq("rtp_participant", true);
  if (zelle === "true") query = query.eq("zelle_participant", true);

  query = query.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  const { data: banks, count } = await query;
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex w-full max-w-4xl flex-col px-6 pt-10 pb-16">
        <Link href="/" className="text-sm text-slate-400 hover:text-white transition">
          ← Back to search
        </Link>

        <h1 className="mt-4 text-3xl font-bold">All banks</h1>
        <p className="mt-1 text-sm text-slate-400">
          {total} bank{total !== 1 ? "s" : ""} matching your filters.
        </p>

        <form method="GET" className="mt-6 flex flex-wrap items-center gap-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <input
            type="text"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search by name..."
            className="min-w-[200px] flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-500 outline-none focus:border-blue-500"
          />
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" name="fednow" value="true" defaultChecked={fednow === "true"} className="h-4 w-4" />
            FedNow only
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" name="rtp" value="true" defaultChecked={rtp === "true"} className="h-4 w-4" />
            RTP only
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" name="zelle" value="true" defaultChecked={zelle === "true"} className="h-4 w-4" />
            Zelle only
          </label>
          <button
            type="submit"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500"
          >
            Filter
          </button>
          {(q || fednow || rtp || zelle) && (
            <Link href="/banks" className="text-sm text-slate-400 hover:text-white transition">
              Clear
            </Link>
          )}
        </form>

        <div className="mt-6 grid gap-2 sm:grid-cols-2">
          {(banks ?? []).length === 0 ? (
            <p className="text-sm text-slate-500">No banks match those filters.</p>
          ) : (
            (banks ?? []).map((bank) => (
              <Link
                key={bank.id}
                href={`/banks/${bank.slug}`}
                className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/70 p-3 text-sm text-slate-200 hover:border-blue-500/40 hover:text-white transition"
              >
                <span>{bank.name}</span>
                <span className="flex gap-1 text-xs">
                  {bank.fednow_participant && <span className="text-purple-400">🏦</span>}
                  {bank.rtp_participant && <span className="text-green-400">⚡</span>}
                  {bank.zelle_participant && <Banknote className="h-4 w-4 text-violet-400" />}
                </span>
              </Link>
            ))
          )}
        </div>

        {totalPages > 1 && (
          <div className="mt-6 flex items-center justify-center gap-4 text-sm">
            {page > 1 ? (
              <Link href={buildPageUrl({ q, fednow, rtp, zelle }, page - 1)} className="text-blue-400 hover:text-blue-300 transition">
                ← Previous
              </Link>
            ) : (
              <span className="text-slate-700">← Previous</span>
            )}
            <span className="text-slate-500">
              Page {page} of {totalPages}
            </span>
            {page < totalPages ? (
              <Link href={buildPageUrl({ q, fednow, rtp, zelle }, page + 1)} className="text-blue-400 hover:text-blue-300 transition">
                Next →
              </Link>
            ) : (
              <span className="text-slate-700">Next →</span>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
