import "server-only";
import type { Metadata } from "next";
import Link from "next/link";
import { LegalFooterLinks } from "@/components/LegalFooterLinks";
import { resolveDirectoryPage, needsFreshReportsMetadata } from "@/lib/seo";
import {
  getCachedRoutesNeedingFreshReports,
  isPageOutOfRange,
  REASON_LABELS,
  type NeedsFreshReportRoute,
} from "@/lib/needsFreshReports";

const PAGE_SIZE = 25;

type SearchParams = { page?: string };

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<Metadata> {
  const { page: pageParam } = await searchParams;
  return needsFreshReportsMetadata(resolveDirectoryPage(pageParam));
}

function buildPageUrl(page: number) {
  return page > 1 ? `/routes/needs-fresh-reports?page=${page}` : "/routes/needs-fresh-reports";
}

function ReasonLine({ route }: { route: NeedsFreshReportRoute }) {
  return (
    <span className="text-xs text-slate-400">
      {REASON_LABELS[route.reason]}
      {route.lastObservationDate && ` · last observed ${route.lastObservationDate}`}
    </span>
  );
}

export default async function NeedsFreshReportsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { page: pageParam } = await searchParams;
  const page = resolveDirectoryPage(pageParam);

  // Cached (hourly) at the data layer, not the route segment — reading
  // searchParams above already makes this segment dynamic, so a route-level
  // revalidate export would be a no-op. See lib/needsFreshReports.ts.
  const allRoutes = await getCachedRoutesNeedingFreshReports();
  const total = allRoutes.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageRoutes = allRoutes.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex w-full max-w-4xl flex-col px-6 pt-10 pb-16">
        <h1 className="text-center text-3xl font-bold">Routes that need fresh reports</h1>
        <p className="mt-1 text-center text-sm text-slate-400">
          {total} route{total !== 1 ? "s" : ""} with no evidence, limited evidence, or evidence older than
          180 days. Pick one and report what you see.
        </p>

        <div className="mt-6 grid gap-2">
          {pageRoutes.length === 0 ? (
            isPageOutOfRange(page, total, PAGE_SIZE) ? (
              <p className="text-center text-sm text-slate-500">
                No routes on page {page}.{" "}
                <Link href="/routes/needs-fresh-reports" className="text-blue-400 hover:text-blue-300 transition">
                  Back to page 1
                </Link>
              </p>
            ) : (
              <p className="text-center text-sm text-slate-500">
                Nothing needs a fresh report right now — every checked route has solid evidence.
              </p>
            )
          ) : (
            pageRoutes.map((route) => (
              <Link
                key={`${route.fromBankId}::${route.toBankId}`}
                href={`/?from=${route.fromBankSlug}&to=${route.toBankSlug}#search`}
                className="flex flex-col rounded-lg border border-slate-800 bg-slate-900/70 p-3 text-sm text-slate-200 hover:border-blue-500/40 hover:text-white transition"
              >
                <span>
                  {route.fromBankName} → {route.toBankName}
                </span>
                <ReasonLine route={route} />
              </Link>
            ))
          )}
        </div>

        {totalPages > 1 && (
          <div className="mt-6 flex items-center justify-center gap-4 text-sm">
            {page > 1 ? (
              <Link href={buildPageUrl(page - 1)} className="text-blue-400 hover:text-blue-300 transition">
                ← Previous
              </Link>
            ) : (
              <span className="text-slate-700">← Previous</span>
            )}
            <span className="text-slate-500">
              Page {page} of {totalPages}
            </span>
            {page < totalPages ? (
              <Link href={buildPageUrl(page + 1)} className="text-blue-400 hover:text-blue-300 transition">
                Next →
              </Link>
            ) : (
              <span className="text-slate-700">Next →</span>
            )}
          </div>
        )}

        <LegalFooterLinks />
      </div>
    </main>
  );
}
