import { apiCsv } from "@/lib/apiResponse";
import { toCsv } from "@/lib/csv";
import { flattenCoverageReportToRows } from "@/lib/coverageReport";
import { getCachedCoverageReport } from "@/lib/coverageReportFreshness";

// Not wrapped in withApiProtection (lib/apiResponse.ts) — that's scoped to
// the documented, versioned /api/* surface (X-Api-Version, CORS preflight,
// legacy-host redirect, rate limiting) listed on /developers. This is a
// download link off one specific page, not a polled integration, and it's
// already cheap to serve — getCachedCoverageReport() is the same
// unstable_cache'd function the page itself uses, so repeated hits cost
// nothing beyond the shared 4h-revalidated cache.
//
// force-dynamic: without it, Next could statically bake in a build-time
// snapshot instead of respecting that 4h revalidation window. The page
// needs this for its own headers() call (CSP nonce); this route has no such
// call, so it needs the export explicitly.
export const dynamic = "force-dynamic";

export async function GET() {
  const report = await getCachedCoverageReport();
  const csv = toCsv(flattenCoverageReportToRows(report));
  return apiCsv(csv, "instant-payments-coverage.csv");
}
