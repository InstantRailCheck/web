export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { headers } from "next/headers";
import { Hero } from "@/components/Hero";
import { HomeRouteChecker } from "@/components/HomeRouteChecker";
import { createClient } from "@/lib/supabase/server";
import { getBankBySlug } from "@/lib/bankProfile";
import { LegalFooterLinks } from "@/components/LegalFooterLinks";
import { SITE_URL } from "@/lib/siteConfig";
import { HOME_CANONICAL_URL } from "@/lib/seo";
import { logError } from "@/lib/logger";

// /?from=chase&to=sofi#search is a shareable application state, not a
// distinct SEO landing page — every route-query variant canonicalizes to
// the bare homepage.
export const metadata: Metadata = {
  alternates: { canonical: HOME_CANONICAL_URL },
};

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ auth_error?: string; account_deleted?: string; from?: string; to?: string }>;
}) {
  const { auth_error, account_deleted, from, to } = await searchParams;
  const [initialFromBank, initialToBank] = await Promise.all([
    from ? getBankBySlug(from) : Promise.resolve(null),
    to ? getBankBySlug(to) : Promise.resolve(null),
  ]);
  const supabase = await createClient();
  let bankCount = 0;
  let hasError = false;
  try {
    const { count, error: countError } = await supabase
      .from("banks")
      .select("id", { count: "exact", head: true });
    if (countError) throw countError;
    bankCount = count ?? 0;
  } catch (err) {
    hasError = true;
    // Previously this raw error message was shown directly to the visitor
    // instead of being logged anywhere server-side — the only place a
    // failure was recorded at all was a public-facing error string.
    logError("Failed to load bank count on homepage", {
      route: "/",
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Nonce required even for a non-executing script tag — script-src governs
  // any <script> element regardless of type under this site's CSP.
  const nonce = (await headers()).get("x-nonce");
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "InstantRailCheck",
    url: SITE_URL,
    potentialAction: {
      "@type": "SearchAction",
      target: `${SITE_URL}/banks?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };
  // Google reads this (not Search Console) to source the larger brand
  // logo shown in knowledge panels/rich results — the square 512x512 PNG
  // is its recommended format.
  const organizationJsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "InstantRailCheck",
    url: SITE_URL,
    logo: `${SITE_URL}/android-chrome-512x512.png`,
  };

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <script
        type="application/ld+json"
        nonce={nonce ?? undefined}
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        nonce={nonce ?? undefined}
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
      />
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center px-6 pt-6 pb-16">

        <Hero />

        <div id="search" className="mt-8 w-full max-w-4xl">
          {auth_error && (
            <p className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
              Sign-in failed. Please try again.
            </p>
          )}
          {account_deleted && (
            <p className="mb-4 rounded-xl border border-slate-700 bg-slate-900/70 p-4 text-sm text-slate-300">
              Your account has been deleted.
            </p>
          )}
          {hasError ? (
            <p className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-red-200">
              Something went wrong loading this page. Please try again shortly.
            </p>
          ) : (
            // Keyed on the resolved slugs (not the raw URL params) so a
            // shared link or browser back/forward — which each arrive as a
            // fresh server render with new initial banks — forces a clean
            // remount instead of trying to resync already-mounted pickers.
            <HomeRouteChecker
              key={`${initialFromBank?.slug ?? ""}-${initialToBank?.slug ?? ""}`}
              bankCount={bankCount}
              initialFromBank={initialFromBank}
              initialToBank={initialToBank}
            />
          )}
        </div>

        <section
          id="how-it-works"
          className="mx-auto mt-16 w-full max-w-4xl px-6 text-center"
        >
          <h2 className="text-2xl font-semibold text-white">
            How it works
          </h2>

          <div className="mt-8 grid gap-6 md:grid-cols-3 text-left">

            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
              <h3 className="font-semibold text-white">1. Select banks</h3>
              <p className="mt-2 text-sm text-slate-400">
                Choose a sending bank and a receiving bank.
              </p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
              <h3 className="font-semibold text-white">2. We analyze routes</h3>
              <p className="mt-2 text-sm text-slate-400">
                We check available transfer rails like ACH, RTP, FedNow, and Zelle.
              </p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
              <h3 className="font-semibold text-white">3. See results</h3>
              <p className="mt-2 text-sm text-slate-400">
                You get a simple breakdown of how money moves between banks.
              </p>
            </div>

          </div>
        </section>

        <LegalFooterLinks />

      </div>
    </main>
  );
}
