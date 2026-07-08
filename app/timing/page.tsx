import Link from "next/link";
import { getTimingLeaderboard } from "@/lib/timingLeaderboard";

export const dynamic = "force-dynamic";

const RAIL_ORDER = ["RTP", "FedNow", "ACH", "Wire", "Zelle"];

export default async function TimingLeaderboardPage() {
  const leaderboard = await getTimingLeaderboard();
  const rails = Object.keys(leaderboard).sort(
    (a, b) => RAIL_ORDER.indexOf(a) - RAIL_ORDER.indexOf(b)
  );

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex w-full max-w-4xl flex-col px-6 pt-10 pb-16">
        <Link href="/" className="text-sm text-slate-400 hover:text-white transition">
          ← Back to search
        </Link>

        <h1 className="mt-4 text-3xl font-bold">Settlement time leaderboard</h1>
        <p className="mt-1 text-sm text-slate-400">
          Average settlement time by rail, based on community-submitted reports.
        </p>

        {rails.length === 0 ? (
          <p className="mt-8 text-sm text-slate-500">
            No timing data reported yet. Submit a route report with a settlement time to get started.
          </p>
        ) : (
          <div className="mt-8 space-y-8">
            {rails.map((rail) => (
              <section key={rail}>
                <h2 className="text-lg font-semibold">{rail}</h2>
                <div className="mt-3 divide-y divide-slate-800 rounded-2xl border border-slate-800 bg-slate-900/70">
                  {leaderboard[rail].map((entry, i) => (
                    <Link
                      key={entry.bankId}
                      href={`/banks/${entry.bankId}`}
                      className="flex items-center justify-between px-5 py-3 text-sm hover:bg-slate-900 transition"
                    >
                      <span className="flex items-center gap-3">
                        <span className="w-5 text-slate-500">{i + 1}</span>
                        <span className="text-slate-100">{entry.bankName}</span>
                      </span>
                      <span className="text-slate-400">
                        ~{entry.avgTime}m{" "}
                        <span className="text-slate-600">
                          ({entry.sampleSize} report{entry.sampleSize !== 1 ? "s" : ""})
                        </span>
                      </span>
                    </Link>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
