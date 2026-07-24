import "server-only";
import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCachedRoutesNeedingFreshReports } from "@/lib/needsFreshReports";
import { getEddOpportunities } from "@/lib/communityRails";
import { distributionBucketLabel } from "@/lib/eddLeaderboard";
import {
  fetchUserSubmissionPage,
  fetchUserOpenRouteRequestCount,
  type RouteReportModerationRow,
  type EddReportModerationRow,
  type RouteRequestModerationRow,
  type UserHistoryRow,
} from "@/lib/moderation";
import { RouteRow } from "@/app/routes/needs-fresh-reports/page";
import { SubmitRouteReport } from "@/components/SubmitRouteReport";
import { SubmitEddReport } from "@/components/SubmitEddReport";
import { RequestRouteForm } from "@/components/RequestRouteForm";
import { ContributeSignInPrompt } from "@/components/ContributeSignInPrompt";
import { PageBreadcrumb } from "@/components/PageBreadcrumb";
import { LegalFooterLinks } from "@/components/LegalFooterLinks";
import { SITE_URL } from "@/lib/siteConfig";

export const dynamic = "force-dynamic";

const TITLE = "Contribute | InstantRailCheck";
const DESCRIPTION =
  "See exactly which routes and banks need your report most, plus a private summary of what you've already contributed.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/contribute` },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: `${SITE_URL}/contribute`,
    siteName: "InstantRailCheck",
    type: "website",
  },
};

// Curated, not paginated — the exhaustive route list already lives at
// /routes/needs-fresh-reports; this hub surfaces only the top slice so it
// reads as "do this next," not another full directory.
const TOP_ROUTES_LIMIT = 8;
// Kept small partly because each card embeds its own live SubmitEddReport
// form (its own auth-state subscription) — see lib/eddOpportunities.ts.
const TOP_EDD_OPPORTUNITIES_LIMIT = 6;
const PRIVATE_SUMMARY_ITEM_LIMIT = 5;

// Exported (not just used inline below) so its markup can be unit tested
// in isolation, same reasoning as RouteRow in app/routes/needs-fresh-
// reports/page.tsx — this is also the only piece of this page worth
// rendering directly in a test, since the default export is an async
// Server Component that awaits mocked data-layer calls, which isn't
// something @testing-library/react can render outside a real RSC runtime.
export type PrivateSummary = {
  routeReports: { total: number; recent: RouteReportModerationRow[] };
  eddReports: { total: number; recent: EddReportModerationRow[] };
  openRequests: { total: number; recent: RouteRequestModerationRow[] };
};

// fetchUserSubmissionPage's route_requests results mix fulfilled and
// unfulfilled rows — this narrows the displayed *items* to open ones only.
// The displayed *count* comes from fetchUserOpenRouteRequestCount instead,
// which is exact even for a user with more requests than one page covers.
function isOpenRouteRequest(row: UserHistoryRow): row is RouteRequestModerationRow {
  return row.type === "route_requests" && row.fulfilledAt === null;
}

async function loadPrivateSummary(userId: string): Promise<PrivateSummary> {
  const [routeReportsPage, eddReportsPage, routeRequestsPage, openRequestCount] = await Promise.all([
    fetchUserSubmissionPage(userId, "route_reports", 1),
    fetchUserSubmissionPage(userId, "edd_reports", 1),
    fetchUserSubmissionPage(userId, "route_requests", 1),
    fetchUserOpenRouteRequestCount(userId),
  ]);

  return {
    routeReports: {
      total: routeReportsPage.total,
      recent: routeReportsPage.rows
        .filter((r): r is RouteReportModerationRow => r.type === "route_reports")
        .slice(0, PRIVATE_SUMMARY_ITEM_LIMIT),
    },
    eddReports: {
      total: eddReportsPage.total,
      recent: eddReportsPage.rows
        .filter((r): r is EddReportModerationRow => r.type === "edd_reports")
        .slice(0, PRIVATE_SUMMARY_ITEM_LIMIT),
    },
    openRequests: {
      total: openRequestCount,
      recent: routeRequestsPage.rows.filter(isOpenRouteRequest).slice(0, PRIVATE_SUMMARY_ITEM_LIMIT),
    },
  };
}

export function PrivateSummaryPanel({ summary }: { summary: PrivateSummary }) {
  const hasAnyRecent =
    summary.routeReports.recent.length > 0 ||
    summary.eddReports.recent.length > 0 ||
    summary.openRequests.recent.length > 0;

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
      <h2 className="text-lg font-semibold">Your contributions</h2>
      <div className="mt-4 grid grid-cols-3 gap-4 text-center">
        <div>
          <p className="text-2xl font-bold">{summary.routeReports.total}</p>
          <p className="text-xs text-slate-400">Route reports</p>
        </div>
        <div>
          <p className="text-2xl font-bold">{summary.eddReports.total}</p>
          <p className="text-xs text-slate-400">EDD reports</p>
        </div>
        <div>
          <p className="text-2xl font-bold">{summary.openRequests.total}</p>
          <p className="text-xs text-slate-400">Open requests</p>
        </div>
      </div>

      {hasAnyRecent && (
        <div className="mt-6 grid gap-2 border-t border-slate-800 pt-4">
          {summary.routeReports.recent.map((r) => (
            <p key={`route-${r.id}`} className="text-sm text-slate-300">
              {r.fromBankName} → {r.toBankName}{" "}
              <span className="text-slate-500">
                · {r.railUsed ?? "Unknown rail"} · {r.status}
              </span>
            </p>
          ))}
          {summary.eddReports.recent.map((r) => (
            <p key={`edd-${r.id}`} className="text-sm text-slate-300">
              {r.bankName} <span className="text-slate-500">· {distributionBucketLabel(r.daysEarly)}</span>
            </p>
          ))}
          {summary.openRequests.recent.map((r) => (
            <p key={`request-${r.id}`} className="text-sm text-slate-300">
              {r.fromBankName} → {r.toBankName} <span className="text-slate-500">· requested</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export default async function ContributePage() {
  const supabase = await createClient();

  const [routes, eddOpportunities, {
    data: { user },
  }] = await Promise.all([getCachedRoutesNeedingFreshReports(), getEddOpportunities(), supabase.auth.getUser()]);

  const privateSummary = user ? await loadPrivateSummary(user.id) : null;

  const topRoutes = routes.slice(0, TOP_ROUTES_LIMIT);
  const topEddOpportunities = eddOpportunities.slice(0, TOP_EDD_OPPORTUNITIES_LIMIT);

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex w-full max-w-3xl flex-col px-6 pt-10 pb-16">
        <PageBreadcrumb items={[{ name: "Home", href: "/" }, { name: "Contribute", href: "/contribute" }]} />

        <h1 className="mt-4 text-center text-3xl font-bold">Contribute</h1>
        <p className="mt-1 text-center text-sm text-slate-400">
          Here&apos;s exactly where a report from you would help most.
        </p>

        <div className="mt-8">
          {privateSummary ? <PrivateSummaryPanel summary={privateSummary} /> : <ContributeSignInPrompt />}
        </div>

        {topRoutes.length > 0 && (
          <section className="mt-10">
            <h2 className="text-lg font-semibold">Routes needing reports</h2>
            <p className="mt-1 text-sm text-slate-400">
              No evidence, limited evidence, or evidence older than 180 days. Pick one and report what you see.
            </p>
            <div className="mt-4 grid gap-2">
              {topRoutes.map((route) => (
                <RouteRow key={`${route.fromBankId}::${route.toBankId}`} route={route} />
              ))}
            </div>
            <p className="mt-3 text-center text-sm">
              <Link href="/routes/needs-fresh-reports" className="text-blue-400 hover:text-blue-300 transition">
                See the full list →
              </Link>
            </p>
          </section>
        )}

        {topEddOpportunities.length > 0 && (
          <section className="mt-10">
            <h2 className="text-lg font-semibold">Early direct deposit opportunities</h2>
            <p className="mt-1 text-sm text-slate-400">
              These banks are closest to a stronger EDD evidence threshold — your report could get them there.
            </p>
            <div className="mt-4 grid gap-4">
              {topEddOpportunities.map((o) => (
                <div key={o.bankId} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                  <p className="text-sm text-slate-200">
                    <span className="font-semibold">{o.bankName}</span> — {o.reportCount} distinct contributor
                    {o.reportCount !== 1 ? "s" : ""} so far
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {o.nextThresholdKind === "visibility"
                      ? "One more report from a new contributor makes this bank's EDD timing visible on its profile page."
                      : `${o.reportsUntilNextThreshold} more report${o.reportsUntilNextThreshold !== 1 ? "s" : ""} from new contributors needed before this bank appears in the EDD leaderboard.`}
                  </p>
                  <SubmitEddReport bankId={o.bankId} bankName={o.bankName} />
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="mt-10">
          <h2 className="text-center text-lg font-semibold">Report anything else</h2>
          <p className="mt-1 text-center text-sm text-slate-400">
            No suggested opportunity fit? Report any route or bank directly.
          </p>
          <SubmitRouteReport />
          <div className="mt-6">
            <RequestRouteForm />
          </div>
          <SubmitEddReport banks />
        </section>

        <LegalFooterLinks />
      </div>
    </main>
  );
}
