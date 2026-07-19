import type { MetadataRoute } from "next";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllBanks } from "@/lib/allBanks";
import { buildBankSitemapEntries, type BankSitemapRow } from "@/lib/sitemapEntries";
import { bankIsIndexable, fetchBankIdsWithAttributableReport, type BankForIndexability } from "@/lib/institutionIndexability";
import { SITE_URL } from "@/lib/siteConfig";

type FetchedBankRow = BankSitemapRow & BankForIndexability & { id: string };

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const supabase = await createClient();
  const banks = await fetchAllBanks<FetchedBankRow>(
    supabase,
    "id, slug, created_at, updated_at, is_active, website, total_assets, fednow_participant, rtp_participant, zelle_participant, aka_names"
  );

  // A single bulk existence check (one Set covering every bank with an
  // attributable report) rather than one query per bank — the sitemap
  // builder runs once per build/request, not once per page, so this must
  // scale to the whole directory in one pass.
  const admin = createAdminClient();
  const bankIdsWithReports = await fetchBankIdsWithAttributableReport(admin);

  // Excluded from the sitemap must also mean noindex on the page itself
  // (app/banks/[slug]/page.tsx's generateMetadata uses the identical
  // predicate) — sending contradictory signals (listed in the sitemap but
  // noindex'd) is worse than being consistently conservative.
  const indexableBanks = (banks ?? []).filter((b) => bankIsIndexable(b, bankIdsWithReports.has(b.id)));

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/banks`, changeFrequency: "daily", priority: 0.8 },
    { url: `${SITE_URL}/rails`, changeFrequency: "daily", priority: 0.7 },
    { url: `${SITE_URL}/early-direct-deposit`, changeFrequency: "daily", priority: 0.6 },
    { url: `${SITE_URL}/compare`, changeFrequency: "weekly", priority: 0.5 },
    { url: `${SITE_URL}/timing`, changeFrequency: "daily", priority: 0.6 },
    { url: `${SITE_URL}/changelog`, changeFrequency: "daily", priority: 0.6 },
    { url: `${SITE_URL}/developers`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${SITE_URL}/methodology`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/privacy`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE_URL}/terms`, changeFrequency: "yearly", priority: 0.2 },
  ];

  return [...staticRoutes, ...buildBankSitemapEntries(indexableBanks)];
}
