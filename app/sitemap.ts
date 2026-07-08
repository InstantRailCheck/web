import type { MetadataRoute } from "next";
import { createClient } from "@/lib/supabase/server";
import { SITE_URL } from "@/lib/siteConfig";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const supabase = await createClient();
  const { data: banks } = await supabase
    .from("banks")
    .select("slug, created_at")
    .order("name");

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/banks`, changeFrequency: "daily", priority: 0.8 },
    { url: `${SITE_URL}/rails`, changeFrequency: "daily", priority: 0.7 },
    { url: `${SITE_URL}/compare`, changeFrequency: "weekly", priority: 0.5 },
    { url: `${SITE_URL}/timing`, changeFrequency: "daily", priority: 0.6 },
    { url: `${SITE_URL}/changelog`, changeFrequency: "daily", priority: 0.6 },
    { url: `${SITE_URL}/developers`, changeFrequency: "monthly", priority: 0.4 },
  ];

  const bankRoutes: MetadataRoute.Sitemap = (banks ?? []).map((bank) => ({
    url: `${SITE_URL}/banks/${bank.slug}`,
    lastModified: bank.created_at ?? undefined,
    changeFrequency: "weekly",
    priority: 0.6,
  }));

  return [...staticRoutes, ...bankRoutes];
}
