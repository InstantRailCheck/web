import Link from "next/link";
import { notFound } from "next/navigation";
import { getBankProfile } from "@/lib/bankProfile";

const RAIL_STYLES: Record<string, { border: string; bg: string; text: string }> = {
  RTP: { border: "border-green-500/30", bg: "bg-green-500/10", text: "text-green-300" },
  FedNow: { border: "border-purple-500/30", bg: "bg-purple-500/10", text: "text-purple-300" },
  ACH: { border: "border-blue-500/30", bg: "bg-blue-500/10", text: "text-blue-300" },
  Wire: { border: "border-slate-800", bg: "bg-slate-900", text: "text-slate-300" },
  Zelle: { border: "border-violet-500/30", bg: "bg-violet-500/10", text: "text-violet-300" },
};

function getRailStyle(rail: string) {
  return RAIL_STYLES[rail] ?? { border: "border-slate-700", bg: "bg-slate-900", text: "text-slate-300" };
}

function RailList({ rails }: { rails: Awaited<ReturnType<typeof getBankProfile>>["sending"] }) {
  if (rails.length === 0) {
    return <p className="text-sm text-slate-500">No reports yet.</p>;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {rails.map((rail) => {
        const s = getRailStyle(rail.rail);
        return (
          <div key={rail.rail} className={`rounded-lg border ${s.border} ${s.bg} p-3 text-sm ${s.text}`}>
            <div>
              {rail.rail}: {Math.round(rail.successRate * 100)}% success
              {rail.avgTime !== null && ` · ~${rail.avgTime}m avg`}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-2 text-xs opacity-70">
              {rail.isStale && <span className="text-yellow-400">⚠ Stale</span>}
              {rail.lastTested && <span>Last tested {rail.lastTested}</span>}
              <span>{rail.count} report{rail.count !== 1 ? "s" : ""}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default async function BankProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await getBankProfile(id);

  if (!profile.bank) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex w-full max-w-4xl flex-col px-6 pt-10 pb-16">
        <Link href="/" className="text-sm text-slate-400 hover:text-white transition">
          ← Back to search
        </Link>

        <h1 className="mt-4 text-3xl font-bold">{profile.bank.name}</h1>
        {profile.bank.website && (
          <a
            href={profile.bank.website}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 text-sm text-blue-400 hover:text-blue-300"
          >
            {profile.bank.website}
          </a>
        )}

        <section className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
          <h2 className="text-lg font-semibold">Sending from {profile.bank.name}</h2>
          <p className="mt-1 text-sm text-slate-400">
            Rails observed when {profile.bank.name} was the sending bank.
          </p>
          <div className="mt-4">
            <RailList rails={profile.sending} />
          </div>
        </section>

        <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
          <h2 className="text-lg font-semibold">Receiving into {profile.bank.name}</h2>
          <p className="mt-1 text-sm text-slate-400">
            Rails observed when {profile.bank.name} was the receiving bank.
          </p>
          <div className="mt-4">
            <RailList rails={profile.receiving} />
          </div>
        </section>
      </div>
    </main>
  );
}
