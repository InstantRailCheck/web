import type { Metadata } from "next";
import { SITE_URL } from "@/lib/siteConfig";

export const HOME_CANONICAL_URL = `${SITE_URL}/`;

// Shared with app/banks/page.tsx's own pagination so the canonical URL and
// the actual query executed against the DB always agree on what "page 2"
// means, instead of two copies of this formula silently drifting apart.
// Only a safe integer >= 1 is a valid page — anything else (decimals,
// Infinity/NaN, negatives) normalizes to page 1 rather than flowing into
// the DB range query or the canonical URL unchanged.
export function resolveDirectoryPage(pageParam?: string): number {
  const parsed = Number(pageParam);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : 1;
}

// page 1 has no query string at all — /banks?page=1 is a redundant variant
// of /banks, not a distinct canonical target.
export function banksDirectoryCanonicalPath(page: number): string {
  return page > 1 ? `/banks?page=${page}` : "/banks";
}

const BANKS_FILTER_PARAM_KEYS = ["q", "fednow", "rtp", "zelle", "edd"] as const;

export type BanksDirectorySearchParams = {
  q?: string;
  fednow?: string;
  rtp?: string;
  zelle?: string;
  edd?: string;
  page?: string;
};

// Search/filter combinations are noindexed (crawl budget on a large
// combinatorial URL space) but still followed so Google can reach every
// bank profile through them, and they canonicalize to the plain
// page-normalized listing so any authority they do accumulate consolidates
// onto the indexable page rather than the filtered variant.
export function banksDirectoryMetadata(params: BanksDirectorySearchParams): Metadata {
  const page = resolveDirectoryPage(params.page);
  const canonical = `${SITE_URL}${banksDirectoryCanonicalPath(page)}`;
  const hasFilter = BANKS_FILTER_PARAM_KEYS.some((key) => Boolean(params[key]));

  return {
    alternates: { canonical },
    ...(hasFilter ? { robots: { index: false, follow: true } } : {}),
  };
}

// Mirrors banksDirectoryCanonicalPath's page-1-has-no-query-string rule.
export function needsFreshReportsCanonicalPath(page: number): string {
  return page > 1 ? `/routes/needs-fresh-reports?page=${page}` : "/routes/needs-fresh-reports";
}

// noindex initially: the page's real-world value (crawlability, uniqueness
// vs. the homepage checker) hasn't been established yet, so it starts
// deliberately unindexed while still followable/shareable.
export function needsFreshReportsMetadata(page: number): Metadata {
  return {
    alternates: { canonical: `${SITE_URL}${needsFreshReportsCanonicalPath(page)}` },
    robots: { index: false, follow: true },
  };
}

export type CompareSearchParams = {
  banks?: string;
};

// Any specific comparison is a combinatorial URL (banks × banks) that isn't
// a crawl/index target yet, but the picker UI on /compare?banks=a,b still
// needs to be reachable and shareable, so noindex,follow rather than
// blocking the route entirely.
export function compareMetadata(params: CompareSearchParams): Metadata {
  return {
    alternates: { canonical: `${SITE_URL}/compare` },
    ...(params.banks ? { robots: { index: false, follow: true } } : {}),
  };
}
