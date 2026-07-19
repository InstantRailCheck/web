import type { Metadata } from "next";
import Link from "next/link";
import { Clock } from "lucide-react";
import { getEddLeaderboardData } from "@/lib/communityRails";
import {
  distributionBucketLabel,
  typicalValueLabel,
  EDD_EVIDENCE_LABEL_TEXT,
  EDD_LEADERBOARD_MIN_REPORTERS,
  type EddLeaderboardEntry,
} from "@/lib/eddLeaderboard";
import { EDD_MIN_REPORTERS } from "@/lib/bankProfile";
import { formatMonthYear } from "@/lib/utils";
import { SubmitEddReport } from "@/components/SubmitEddReport";
import { LegalFooterLinks } from "@/components/LegalFooterLinks";
import { SITE_URL } from "@/lib/siteConfig";

export const dynamic = "force-dynamic";

const TITLE = "Early Direct Deposit Leaderboard | InstantRailCheck";
const DESCRIPTION =
  "Compare community-reported early direct deposit timing across U.S. banks and credit unions.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/early-direct-deposit` },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: `${SITE_URL}/early-direct-deposit`,
    siteName: "InstantRailCheck",
    type: "website",
  },
};

function DistributionBars({ entry }: { entry: EddLeaderboardEntry }) {
  const buckets = Object.entries(entry.distribution)
    .map(([bucket, count]) => [Number(bucket), count as number] as const)
    .filter(([, count]) => count > 0)
    .sort((a, b) => a[0] - b[0]);

  if (buckets.length === 0) return null;

  return (
    <ul className="mt-2 space-y-0.5 text-xs text-slate-500">
      {buckets.map(([bucket, count]) => (
        <li key={bucket}>
          {distributionBucketLabel(bucket)}: {count} report{count !== 1 ? "s" : ""}
        </li>
      ))}
    </ul>
  );
}

function LeaderboardRow({ entry, rank }: { entry: EddLeaderboardEntry; rank?: number }) {
  return (
    <Link
      href={`/banks/${entry.bankSlug}`}
      className="block px-5 py-4 text-sm text-slate-200 hover:bg-slate-900 hover:text-white transition"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-3">
          {rank !== undefined && <span className="w-5 shrink-0 text-slate-500">{rank}</span>}
          <span className="font-medium">{entry.bankName}</span>
        </span>
        <span className="shrink-0 text-right text-xs text-slate-400">
          <div>
            Typically reported <strong className="text-slate-100">{typicalValueLabel(entry.typical)}</strong>
          </div>
          <div className="mt-0.5">
            {entry.reportCount} distinct reporter{entry.reportCount !== 1 ? "s" : ""}
            {entry.evidenceLabel && <> · {EDD_EVIDENCE_LABEL_TEXT[entry.evidenceLabel]}</>}
          </div>
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Last reported {formatMonthYear(entry.latestReportDate)}
        {entry.isStale && " (no reports in the last 180 days)"}
      </p>
      <DistributionBars entry={entry} />
    </Link>
  );
}

export default async function EarlyDirectDepositPage() {
  const { ranked, earlyEvidence } = await getEddLeaderboardData();

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex w-full max-w-3xl flex-col px-6 pt-10 pb-16">
        <nav aria-label="Breadcrumb" className="mb-4 text-center text-sm text-slate-500">
          <ol className="inline-flex items-center gap-2">
            <li>
              <Link href="/rails" className="hover:text-slate-300 transition">
                Rail explorer
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li aria-current="page" className="text-slate-300">
              Early Direct Deposit
            </li>
          </ol>
        </nav>

        <h1 className="flex items-center justify-center gap-2 text-center text-3xl font-bold">
          <Clock className="h-7 w-7 text-teal-300" /> Early Direct Deposit Leaderboard
        </h1>
        <p className="mt-2 text-center text-sm text-slate-400">
          Community-reported early direct deposit timing by financial institution.
        </p>
        <p className="mt-4 rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-center text-xs text-yellow-200/90">
          Deposit timing can depend on when an employer, benefits agency, or payroll provider
          sends the payment file. A bank&apos;s past timing does not guarantee future availability.
        </p>
        <p className="mt-3 text-center text-xs text-slate-500">
          Rankings mix every deposit type reported (paychecks, government benefits, tax refunds,
          pensions, and gig-platform payouts) since paycheck-specific timing isn&apos;t yet broken
          out separately.
        </p>

        <section className="mt-8">
          <h2 className="text-center text-xl font-semibold">Ranked institutions</h2>
          <p className="mt-1 text-center text-xs text-slate-500">
            Requires at least {EDD_LEADERBOARD_MIN_REPORTERS} distinct reporters to appear.
          </p>

          {ranked.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/70 px-5 py-8 text-center">
              <p className="text-sm text-slate-400">
                No institution has {EDD_LEADERBOARD_MIN_REPORTERS} or more distinct community
                reports yet, so nothing meets the bar for a credible ranking.
              </p>
              <p className="mt-2 text-sm text-slate-500">
                Reported early direct deposit at your bank? Submitting a report below helps get
                this leaderboard started.
              </p>
            </div>
          ) : (
            <div className="mt-4 divide-y divide-slate-800 rounded-2xl border border-slate-800 bg-slate-900/70">
              {ranked.map((entry, i) => (
                <LeaderboardRow key={entry.bankId} entry={entry} rank={i + 1} />
              ))}
            </div>
          )}
        </section>

        {earlyEvidence.length > 0 && (
          <section className="mt-10">
            <h2 className="text-center text-xl font-semibold">Early evidence</h2>
            <p className="mt-1 text-center text-xs text-slate-500">
              {EDD_MIN_REPORTERS}-{EDD_LEADERBOARD_MIN_REPORTERS - 1}{" "}
              distinct reporters — not enough yet for a ranked position, shown unranked and in no
              particular order of confidence.
            </p>
            <div className="mt-4 divide-y divide-slate-800 rounded-2xl border border-slate-800 bg-slate-900/70">
              {earlyEvidence.map((entry) => (
                <LeaderboardRow key={entry.bankId} entry={entry} />
              ))}
            </div>
          </section>
        )}

        <div className="mt-10">
          <SubmitEddReport banks />
        </div>

        <section id="methodology" className="mt-12 scroll-mt-8 border-t border-slate-800 pt-8 text-sm text-slate-300">
          <h2 className="text-lg font-semibold text-white">Methodology</h2>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-slate-400">
            <li>
              Only signed-in, attributable reports count, and only each reporter&apos;s newest
              report per institution — repeat submissions from one person never inflate a count.
            </li>
            <li>
              An institution needs at least {EDD_LEADERBOARD_MIN_REPORTERS} distinct reporters to
              be ranked; {EDD_MIN_REPORTERS}-{EDD_LEADERBOARD_MIN_REPORTERS - 1}{" "}
              reporters appear in the unranked &quot;Early evidence&quot; section instead.
            </li>
            <li>
              The headline number is the <strong className="text-slate-200">typical (median)</strong>{" "}
              reported value, not a raw average — a report of &quot;more than 5 days early&quot;
              is a censored value, not literally six days, so it&apos;s never averaged in as an
              exact number. When the typical value would fall on or need to cross that
              censored bucket, it&apos;s shown as &quot;more than 5 days early&quot; rather than an
              invented number.
            </li>
            <li>
              Ties are broken, in order, by: the share of an institution&apos;s reports at or above
              its typical value, then by sample size, then alphabetically by name.
            </li>
            <li>
              Evidence labels reflect sample size only, not certainty:{" "}
              {EDD_EVIDENCE_LABEL_TEXT.emerging} (5-9 reporters),{" "}
              {EDD_EVIDENCE_LABEL_TEXT.moderate} (10-24), {EDD_EVIDENCE_LABEL_TEXT.strong} (25+).
            </li>
            <li>
              Inactive institutions never appear here, even with qualifying historical evidence —
              their evidence remains visible on their own profile page.
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
          </Link>{" "}
          ·{" "}
          <Link href="/banks?edd=true" className="text-blue-400 hover:text-blue-300 transition">
            browse all banks with early direct deposit evidence
          </Link>
        </p>

        <LegalFooterLinks />
      </div>
    </main>
  );
}
