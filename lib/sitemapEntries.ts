import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/siteConfig";

export type BankSitemapRow = {
  slug: string;
  created_at: string | null;
  updated_at: string | null;
};

// Prefers updated_at (maintained by a DB trigger on every real content
// change) over created_at, which never changes after insert and so can't
// reflect e.g. an aka_names/name correction made long after a bank row was
// first created. Never uses the current request time — this route is
// cached by default, and new Date() here would make every bank look
// "just modified" on every single request regardless of whether anything
// actually changed, defeating the point of freshness tracking entirely.
export function buildBankSitemapEntries(banks: BankSitemapRow[]): MetadataRoute.Sitemap {
  return banks.map((bank) => ({
    url: `${SITE_URL}/banks/${bank.slug}`,
    lastModified: bank.updated_at ?? bank.created_at ?? undefined,
    changeFrequency: "weekly",
    priority: 0.6,
  }));
}
