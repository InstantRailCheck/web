import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { LegalFooterLinks } from "@/components/LegalFooterLinks";
import { PageBreadcrumb } from "@/components/PageBreadcrumb";
import { CoverageBarChart } from "@/components/CoverageBarChart";
import { CitationBlock } from "@/components/CitationBlock";
import { getCachedCoverageReport, getCachedCoverageFreshness, maxDate } from "@/lib/coverageReportFreshness";
import { buildDatasetJsonLd, safeJsonLdString } from "@/lib/jsonLd";
import { buildCoverageReportCitation } from "@/lib/citation";
import { ZELLE_INCOMPLETE_CAVEAT } from "@/lib/railDisplayName";
import { SITE_URL } from "@/lib/siteConfig";
import { pct, type CoverageBreakdown, type RailBuckets } from "@/lib/coverageReport";

const TITLE = "U.S. Instant Payments Coverage Report | InstantRailCheck";
const DESCRIPTION =
  "How many active U.S. banks and credit unions are confirmed participants on FedNow, RTP, and Zelle — broken down by institution type, asset size, and state.";
const PAGE_URL = `${SITE_URL}/research/instant-payments`;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PAGE_URL },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: PAGE_URL,
    siteName: "InstantRailCheck",
    type: "website",
  },
};

// force-dynamic, explicitly — this page's own headers() call (below) was
// assumed to be enough to keep Next from ever attempting to statically
// prerender this route (see coverage.csv/route.ts's comment), but that
// assumption was wrong in practice: getCachedCoverageReport()/
// getCachedCoverageFreshness() run BEFORE headers() in this function body,
// so in any environment without Supabase configured (e.g. CI's `npm run
// build`, which has no .env.local and no reason to need real DB access
// just to type-check and bundle), the admin client throws during
// build-time prerendering before Next's automatic dynamic-detection ever
// reaches the headers() call — a hard build failure instead of a graceful
// opt-out of static generation. Confirmed by reproducing locally: renaming
// .env.local aside and running `npx next build` fails with the exact same
// "supabaseUrl is required." error CI has been hitting on every commit
// since this page shipped (v10.0.0). This export sidesteps the ordering
// problem entirely by declaring the route dynamic before any page code runs.
export const dynamic = "force-dynamic";

// timeZone: "UTC" is required, not decorative — without it this reads the
// server process's local zone, which can roll the displayed calendar date
// back a day for any finished_at timestamp after ~5pm PT (matches
// lib/utils.ts's formatMonthYear, which pins UTC for the same reason).
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

const AUTHORITY_LABELS = {
  fdic: "FDIC-insured banks",
  ncua: "NCUA credit unions",
  unknown: "Type not on file",
} as const;

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <div className="text-2xl font-bold">{value.toLocaleString()}</div>
      <div className="mt-1 text-xs text-slate-400">{label}</div>
    </div>
  );
}

// Confirmed is the primary (bold) figure since it's what most readers scan
// for, but not-confirmed and unknown are always shown too, in the same
// cell — a table showing only "confirmed" would quietly break this report's
// central promise that null and false are never collapsed into one number.
function RailCell({ buckets }: { buckets: RailBuckets }) {
  return (
    <td className="py-2 pr-4 text-right align-top">
      <div>{buckets.confirmed.toLocaleString()}</div>
      <div className="text-[10px] leading-tight text-slate-500">
        {buckets.notConfirmed.toLocaleString()} not · {buckets.unknown.toLocaleString()} unk.
      </div>
    </td>
  );
}

function BreakdownRow({ label, breakdown }: { label: string; breakdown: CoverageBreakdown }) {
  return (
    <tr className="border-b border-slate-900">
      <td className="py-2 pr-4">{label}</td>
      <td className="py-2 pr-4 text-right align-top">{breakdown.total.toLocaleString()}</td>
      <RailCell buckets={breakdown.fednow} />
      <RailCell buckets={breakdown.rtp} />
      <RailCell buckets={breakdown.zelle} />
    </tr>
  );
}

function BreakdownTable({ rows }: { rows: { label: string; breakdown: CoverageBreakdown }[] }) {
  return (
    <>
      <p className="text-xs text-slate-500">Each rail column shows confirmed, then not confirmed / unknown.</p>
      <table className="mt-2 w-full text-sm">
        <thead>
          <tr className="border-b border-slate-800 text-left text-slate-400">
            <th className="py-2 pr-4 font-medium">Institutions</th>
            <th className="py-2 pr-4 text-right font-medium">Count</th>
            <th className="py-2 pr-4 text-right font-medium">FedNow</th>
            <th className="py-2 pr-4 text-right font-medium">RTP</th>
            <th className="py-2 text-right font-medium">Zelle</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <BreakdownRow key={row.label} label={row.label} breakdown={row.breakdown} />
          ))}
        </tbody>
      </table>
    </>
  );
}

export default async function InstantPaymentsCoveragePage() {
  const [report, freshness] = await Promise.all([getCachedCoverageReport(), getCachedCoverageFreshness()]);
  const nonce = (await headers()).get("x-nonce");

  // v10.1: dateModified is real again, not a fabricated approximation —
  // fdicDirectoryAsOf, ncuaDirectoryAsOf, and railParticipationVerifiedAt
  // are now all precise, verified completion timestamps (the last of the
  // three previously didn't exist as a trustworthy signal at all; see
  // PROJECT.md v10.1.0 notes).
  const csvUrl = `${PAGE_URL}/coverage.csv`;
  const dateModified = maxDate(
    maxDate(maxDate(freshness.fdicDirectoryAsOf, freshness.ncuaDirectoryAsOf), freshness.railParticipationVerifiedAt),
    freshness.assetDataAsOf
  );
  const datasetJsonLd = buildDatasetJsonLd({
    name: "U.S. Instant Payments Coverage",
    description: DESCRIPTION,
    url: PAGE_URL,
    dateModified,
    distribution: { contentUrl: csvUrl, encodingFormat: "text/csv" },
  });
  const citationText = buildCoverageReportCitation({ dateModified, url: PAGE_URL });
  const fedNowConfirmedPct = Math.round(pct(report.overall.fednow.confirmed, report.overall.total));

  return (
    <main id="main-content" className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex w-full max-w-4xl flex-col px-6 pt-10 pb-16">
        <script
          type="application/ld+json"
          nonce={nonce ?? undefined}
          dangerouslySetInnerHTML={{ __html: safeJsonLdString(datasetJsonLd) }}
        />
        <PageBreadcrumb
          items={[
            { name: "Home", href: "/" },
            { name: "U.S. Instant Payments Coverage", href: "/research/instant-payments" },
          ]}
        />
        <h1 className="text-center text-3xl font-bold">U.S. Instant Payments Coverage Report</h1>
        <p className="mt-1 text-center text-sm text-slate-400">
          How many active U.S. banks and credit unions are confirmed participants on FedNow, RTP, and
          Zelle. A rail marked &quot;not confirmed&quot; means the institution wasn&apos;t found on that
          rail&apos;s official source list — not that it definitely doesn&apos;t support it.
        </p>

        <section className="mt-6 space-y-1 rounded-xl border border-slate-800 bg-slate-900/30 p-4 text-sm text-slate-300">
          <p>
            <strong className="text-white">{report.totalActive.toLocaleString()}</strong> active U.S. banks and
            credit unions are tracked for instant-payment rail participation.
          </p>
          <p>
            Only <strong className="text-white">{fedNowConfirmedPct}%</strong>{" "}
            are confirmed on FedNow, the Federal Reserve&apos;s instant payment rail.
          </p>
          <p>
            <strong className="text-white">{report.bothFedNowAndRtp.toLocaleString()}</strong> institutions are
            confirmed on both FedNow and RTP.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold">Overview</h2>
          <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Active institutions" value={report.totalActive} />
            <Stat label="FDIC-insured banks" value={report.institutionTypes.fdic} />
            <Stat label="NCUA credit unions" value={report.institutionTypes.ncua} />
            <Stat label="Confirmed on both FedNow & RTP" value={report.bothFedNowAndRtp} />
          </div>
        </section>

        <section className="mt-10 space-y-6">
          <h2 className="text-lg font-semibold">Rail coverage</h2>
          <CoverageBarChart label="FedNow" buckets={report.overall.fednow} />
          <CoverageBarChart label="RTP" buckets={report.overall.rtp} />
          <CoverageBarChart label="Zelle (P2P)" buckets={report.overall.zelle} />
        </section>

        <section className="mt-10 space-y-6">
          <h2 className="text-lg font-semibold">FDIC banks vs. NCUA credit unions</h2>
          {(Object.keys(AUTHORITY_LABELS) as (keyof typeof AUTHORITY_LABELS)[]).map((authority) => (
            <div key={authority}>
              <p className="text-sm font-medium text-slate-300">
                {AUTHORITY_LABELS[authority]} ({report.byAuthority[authority].total.toLocaleString()})
              </p>
              <div className="mt-2 grid gap-4 sm:grid-cols-3">
                <CoverageBarChart label="FedNow" buckets={report.byAuthority[authority].fednow} />
                <CoverageBarChart label="RTP" buckets={report.byAuthority[authority].rtp} />
                <CoverageBarChart label="Zelle" buckets={report.byAuthority[authority].zelle} />
              </div>
            </div>
          ))}
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold">Coverage by asset size</h2>
          <div className="mt-3 overflow-x-auto">
            <BreakdownTable rows={report.byAssetTier.map(({ tier, breakdown }) => ({ label: tier, breakdown }))} />
          </div>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold">Coverage by state or territory</h2>
          <div className="mt-3 max-h-96 overflow-y-auto overflow-x-auto">
            <BreakdownTable rows={report.byState.map(({ state, breakdown }) => ({ label: state, breakdown }))} />
          </div>
        </section>

        <section className="mt-10 rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-4">
          <h2 className="text-sm font-semibold text-yellow-200">About Zelle coverage</h2>
          <p className="mt-1 text-xs text-yellow-200/90">{ZELLE_INCOMPLETE_CAVEAT}</p>
        </section>

        <section className="mt-10 space-y-1 text-xs text-slate-500">
          {freshness.fdicDirectoryAsOf && (
            <p>FDIC bank directory last verified {formatDate(freshness.fdicDirectoryAsOf)}.</p>
          )}
          {freshness.ncuaDirectoryAsOf && (
            <p>NCUA credit union directory last verified {formatDate(freshness.ncuaDirectoryAsOf)}.</p>
          )}
          {freshness.railParticipationVerifiedAt && (
            <p>Rail participation last verified {formatDate(freshness.railParticipationVerifiedAt)}.</p>
          )}
          {freshness.assetDataAsOf && <p>Bank asset data last verified {formatDate(freshness.assetDataAsOf)}.</p>}
          <p>
            See{" "}
            <Link href="/methodology" className="underline hover:text-slate-300">
              methodology
            </Link>{" "}
            for how rail participation is verified.{" "}
            <a href="/research/instant-payments/coverage.csv" download className="underline hover:text-slate-300">
              Download this data as CSV
            </a>
            .
          </p>
        </section>

        <section className="mt-6">
          <CitationBlock citationText={citationText} />
        </section>

        <LegalFooterLinks />
      </div>
    </main>
  );
}
