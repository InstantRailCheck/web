import Link from "next/link";
import { getActivityFeed } from "@/lib/activityFeed";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, string> = {
  success: "text-green-400",
  failed: "text-red-400",
  delayed: "text-yellow-400",
};

// Matches the rail color scheme used everywhere else it's shown (RouteSearch,
// bank profile pages, /banks, /rails) so a rail is recognizable by color site-wide.
const RAIL_COLORS: Record<string, string> = {
  RTP: "text-green-300",
  FedNow: "text-purple-300",
  ACH: "text-blue-300",
  Wire: "text-slate-300",
  Zelle: "text-violet-300",
  "Visa Direct": "text-sky-300",
  "Mastercard Send": "text-orange-300",
};

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default async function ChangelogPage() {
  const feed = await getActivityFeed(50);

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex w-full max-w-4xl flex-col px-6 pt-10 pb-16">
        <Link href="/" className="text-sm text-slate-400 hover:text-white transition">
          ← Back to search
        </Link>

        <h1 className="mt-4 text-center text-3xl font-bold">Changelog</h1>
        <p className="mt-1 text-center text-sm text-slate-400">
          Recent banks added and route reports submitted by the community.
        </p>

        {feed.length === 0 ? (
          <p className="mt-8 text-sm text-slate-500">Nothing here yet.</p>
        ) : (
          <div className="mt-8 divide-y divide-slate-800 rounded-2xl border border-slate-800 bg-slate-900/70">
            {feed.map((item) => (
              <div key={item.id} className="flex items-start justify-between gap-4 px-5 py-4 text-sm">
                {item.type === "bank_added" ? (
                  <p>
                    <span className="text-slate-500">+ Bank added: </span>
                    <Link href={`/banks/${item.bankSlug}`} className="text-blue-400 hover:text-blue-300 transition">
                      {item.bankName}
                    </Link>
                  </p>
                ) : (
                  <p>
                    {item.isFirstConfirmed && (
                      <span className="mr-2 rounded-full bg-green-500/10 px-2 py-0.5 text-xs text-green-400">
                        First confirmed
                      </span>
                    )}
                    <Link href={`/banks/${item.fromBankSlug ?? item.fromBankId}`} className="text-blue-400 hover:text-blue-300 transition">
                      {item.fromBankName}
                    </Link>
                    <span className="text-slate-500"> → {item.toBankName} via </span>
                    <span className={RAIL_COLORS[item.rail] ?? "text-slate-200"}>{item.rail}</span>
                    <span className={`ml-2 ${STATUS_STYLES[item.status] ?? "text-slate-400"}`}>
                      {item.status}
                    </span>
                  </p>
                )}
                <span className="shrink-0 text-xs text-slate-600">{timeAgo(item.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
