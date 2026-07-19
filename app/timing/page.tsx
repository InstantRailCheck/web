import type { Metadata } from "next";
import Link from "next/link";
import {
  getTimingLeaderboard,
  TIMING_EVIDENCE_LABEL_TEXT,
  TIMING_MIN_REPORTERS,
  type TimingLeaderboardEntry,
} from "@/lib/timingLeaderboard";
import { formatMonthYear } from "@/lib/utils";
import { LegalFooterLinks } from "@/components/LegalFooterLinks";
import { PageBreadcrumb } from "@/components/PageBreadcrumb";
import { railDisplayName } from "@/lib/railDisplayName";
import { SITE_URL } from "@/lib/siteConfig";

export const dynamic = "force-dynamic";

const RAIL_ORDER = ["RTP", "FedNow", "Visa Direct", "Mastercard Send", "ACH", "Wire", "Zelle"];

const TITLE = "Settlement Time Leaderboard | InstantRailCheck";
const DESCRIPTION =
  "Compare community-reported payment rail settlement times across U.S. banks and credit unions.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/timing` },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: `${SITE_URL}/timing`,
    siteName: "InstantRailCheck",
    type: "website",
  },
};

function LeaderboardRow({ entry, rank }: { entry: TimingLeaderboardEntry; rank: number }) {
  return (
    <Link
      href={`/banks/${entry.bankSlug}`}
      className="block px-5 py-4 text-sm text-slate-200 hover:bg-slate-900 hover:text-white transition"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-3">
          <span className="w-5 shrink-0 text-slate-500">{rank}</span>
          <span className="font-medium">{entry.bankName}</span>
        </span>
        <span className="shrink-0 text-right text-xs text-slate-400">
          <div>
            Typically settles in <strong className="text-slate-100">~{entry.typicalMinutes}m</strong>
          </div>
          <div className="mt-0.5">
            {entry.sampleSize} report{entry.sampleSize !== 1 ? "s" : ""}
            {entry.evidenceLabel && <> · {TIMING_EVIDENCE_LABEL_TEXT[entry.evidenceLabel]}</>}
          </div>
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Last reported {formatMonthYear(entry.latestObservationDate)}
        {entry.isStale && " (no reports in the last 180 days)"}
      </p>
    </Link>
  );
}

export default async function TimingLeaderboardPage() {
  const leaderboard = await getTimingLeaderboard();
  const rails = Object.keys(leaderboard).sort(
    (a, b) => RAIL_ORDER.indexOf(a) - RAIL_ORDER.indexOf(b)
  );

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex w-full max-w-3xl flex-col px-6 pt-10 pb-16">
        <PageBreadcrumb
          items={[
            { name: "Rail explorer", href: "/rails" },
            { name: "Settlement Time Leaderboard", href: "/timing" },
          ]}
        />

        <h1 className="text-center text-3xl font-bold">Settlement Time Leaderboard</h1>
        <p className="mt-2 text-center text-sm text-slate-400">
          Community-reported settlement time by payment rail.
        </p>
        <p className="mt-4 rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-center text-xs text-yellow-200/90">
          Settlement time can vary by transfer amount, time of day, and network conditions. A
          bank&apos;s past timing does not guarantee future performance.
        </p>

        {rails.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/70 px-5 py-8 text-center">
            <p className="text-sm text-slate-400">
              No institution has {TIMING_MIN_REPORTERS} or more distinct reporters for any rail
              yet, so nothing meets the bar for a credible ranking.
            </p>
            <p className="mt-2 text-sm text-slate-500">
              Submit a route report with a settlement time to get this leaderboard started.
            </p>
          </div>
        ) : (
          <div className="mt-8 space-y-8">
            {rails.map((rail) => (
              <section key={rail}>
                <h2 className="text-lg font-semibold">{railDisplayName(rail)}</h2>
                <p className="mt-1 text-xs text-slate-500">
                  Requires at least {TIMING_MIN_REPORTERS} distinct reporters to appear.
                </p>
                <div className="mt-3 divide-y divide-slate-800 rounded-2xl border border-slate-800 bg-slate-900/70">
                  {leaderboard[rail].map((entry, i) => (
                    <LeaderboardRow key={entry.bankId} entry={entry} rank={i + 1} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        <section id="methodology" className="mt-12 scroll-mt-8 border-t border-slate-800 pt-8 text-sm text-slate-300">
          <h2 className="text-lg font-semibold text-white">Methodology</h2>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-slate-400">
            <li>
              Only signed-in, attributable reports count, and only each reporter&apos;s newest
              report per directional route and rail — repeat submissions from one person never
              inflate a count. Failed transfers are excluded (no meaningful settlement time), but
              delayed-but-completed transfers are included.
            </li>
            <li>
              An institution needs at least {TIMING_MIN_REPORTERS} distinct reporters to appear on
              a given rail.
            </li>
            <li>
              The headline number is the <strong className="text-slate-200">typical (median)</strong>{" "}
              reported settlement time, not a raw average — a single outlier report (e.g. one
              unusually long delay) can swing an average far more than it swings a median.
            </li>
            <li>
              Ties are broken, in order, by: the share of an institution&apos;s reports at or below
              its typical value, then by sample size, then alphabetically by name.
            </li>
            <li>
              Evidence labels reflect sample size only, not certainty:{" "}
              {TIMING_EVIDENCE_LABEL_TEXT.emerging} (5-9 reporters),{" "}
              {TIMING_EVIDENCE_LABEL_TEXT.moderate} (10-24), {TIMING_EVIDENCE_LABEL_TEXT.strong}{" "}
              (25+).
            </li>
            <li>
              Inactive institutions never appear here, even with qualifying historical evidence.
            </li>
            <li>
              No recency weighting is applied — every qualifying report counts equally regardless
              of age. The latest report date is shown instead, and evidence with no report in the
              last 180 days is marked stale.
            </li>
          </ul>
        </section>

        <p className="mt-8 text-center text-xs text-slate-500">
          See also:{" "}
          <Link href="/rails" className="text-blue-400 hover:text-blue-300 transition">
            payment rail explorer
          </Link>
        </p>

        <LegalFooterLinks />
      </div>
    </main>
  );
}
