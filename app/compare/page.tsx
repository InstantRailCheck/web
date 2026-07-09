import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getBankProfileBySlug } from "@/lib/bankProfile";
import { fetchAllBanks } from "@/lib/allBanks";
import { ComparePicker } from "@/components/ComparePicker";
import { formatPhone } from "@/lib/utils";

export const dynamic = "force-dynamic";

function RailCell({ rail }: { rail: { successRate: number; avgTime: number | null; count: number; isStale: boolean } | undefined }) {
  if (!rail) return <span className="text-slate-600">No data</span>;
  return (
    <span>
      {Math.round(rail.successRate * 100)}% success
      {rail.avgTime !== null && ` · ~${rail.avgTime}m`}
      <span className="text-slate-500">
        {" "}
        ({rail.count} report{rail.count !== 1 ? "s" : ""}
        {rail.isStale ? ", stale" : ""})
      </span>
    </span>
  );
}

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ banks?: string }>;
}) {
  const { banks: banksParam } = await searchParams;
  const slugs = (banksParam ?? "").split(",").filter(Boolean).slice(0, 2);

  const supabase = await createClient();
  const allBanks = await fetchAllBanks<{ id: string; slug: string; name: string }>(supabase, "id, slug, name");

  const profiles = slugs.length === 2 ? await Promise.all(slugs.map((slug) => getBankProfileBySlug(slug))) : null;
  const [a, b] = profiles ?? [null, null];

  const rails =
    a && b
      ? Array.from(new Set([...a.sending.map((r) => r.rail), ...b.sending.map((r) => r.rail)]))
      : [];

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex w-full max-w-4xl flex-col px-6 pt-10 pb-16">
        <Link href="/" className="text-sm text-slate-400 hover:text-white transition">
          ← Back to search
        </Link>

        <h1 className="mt-4 text-center text-3xl font-bold">Compare banks</h1>
        <p className="mt-1 text-center text-sm text-slate-400">
          Side-by-side rail capability, contact info, and network participation.
        </p>

        <div className="mt-6">
          <ComparePicker banks={allBanks ?? []} initialSlugs={slugs} />
        </div>

        {a?.bank && b?.bank && (
          <div className="mt-8 overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/70">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-800">
                  <th className="px-5 py-3 text-slate-500">Feature</th>
                  <th className="px-5 py-3">
                    <Link href={`/banks/${a.bank.slug}`} className="text-blue-400 hover:text-blue-300 transition">
                      {a.bank.name}
                    </Link>
                  </th>
                  <th className="px-5 py-3">
                    <Link href={`/banks/${b.bank.slug}`} className="text-blue-400 hover:text-blue-300 transition">
                      {b.bank.name}
                    </Link>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                <tr>
                  <td className="px-5 py-3 text-slate-500">Website</td>
                  <td className="px-5 py-3">{a.bank.website ?? <span className="text-slate-600">—</span>}</td>
                  <td className="px-5 py-3">{b.bank.website ?? <span className="text-slate-600">—</span>}</td>
                </tr>
                <tr>
                  <td className="px-5 py-3 text-slate-500">Address</td>
                  <td className="px-5 py-3">{a.bank.address ?? <span className="text-slate-600">—</span>}</td>
                  <td className="px-5 py-3">{b.bank.address ?? <span className="text-slate-600">—</span>}</td>
                </tr>
                <tr>
                  <td className="px-5 py-3 text-slate-500">Phone</td>
                  <td className="px-5 py-3">{formatPhone(a.bank.phone) ?? <span className="text-slate-600">—</span>}</td>
                  <td className="px-5 py-3">{formatPhone(b.bank.phone) ?? <span className="text-slate-600">—</span>}</td>
                </tr>
                <tr>
                  <td className="px-5 py-3 text-slate-500">FedNow</td>
                  <td className="px-5 py-3">{a.bank.fednow_participant ? "✅" : "—"}</td>
                  <td className="px-5 py-3">{b.bank.fednow_participant ? "✅" : "—"}</td>
                </tr>
                <tr>
                  <td className="px-5 py-3 text-slate-500">RTP</td>
                  <td className="px-5 py-3">{a.bank.rtp_participant ? "✅" : "—"}</td>
                  <td className="px-5 py-3">{b.bank.rtp_participant ? "✅" : "—"}</td>
                </tr>
                <tr>
                  <td className="px-5 py-3 text-slate-500">Zelle</td>
                  <td className="px-5 py-3">{a.bank.zelle_participant ? "✅" : "—"}</td>
                  <td className="px-5 py-3">{b.bank.zelle_participant ? "✅" : "—"}</td>
                </tr>
                {rails.map((rail) => (
                  <tr key={rail}>
                    <td className="px-5 py-3 text-slate-500">{rail}</td>
                    <td className="px-5 py-3">
                      <RailCell rail={a.sending.find((r) => r.rail === rail)} />
                    </td>
                    <td className="px-5 py-3">
                      <RailCell rail={b.sending.find((r) => r.rail === rail)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
