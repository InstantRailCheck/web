export const dynamic = "force-dynamic";

import { headers } from "next/headers";
import { Hero } from "@/components/Hero";
import { RouteSearch } from "@/components/RouteSearch";
import { createClient } from "@/lib/supabase/server";
import { fetchAllBanks } from "@/lib/allBanks";
import { SubmitRouteReport } from "@/components/SubmitRouteReport";
import { SITE_URL } from "@/lib/siteConfig";

type Bank = {
  id: string;
  slug: string;
  name: string;
  website: string | null;
};

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ auth_error?: string }>;
}) {
  const { auth_error } = await searchParams;
  const supabase = await createClient();
  let bankOptions: Bank[] = [];
  let error: { message: string } | null = null;
  try {
    bankOptions = await fetchAllBanks<Bank>(supabase, "id, slug, name, website");
  } catch (err) {
    error = { message: err instanceof Error ? err.message : "Failed to load banks" };
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

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <script
        type="application/ld+json"
        nonce={nonce ?? undefined}
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center px-6 pt-6 pb-16">

        <Hero />

        <div id="search" className="mt-8 w-full max-w-4xl">
          {auth_error && (
            <p className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
              Sign-in failed. Please try again.
            </p>
          )}
          {error ? (
            <p className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-red-200">
              Supabase error: {error.message}
            </p>
          ) : (
            <>
              <RouteSearch banks={bankOptions} />
              <SubmitRouteReport banks={bankOptions} />
            </>
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
                We check available transfer rails like ACH, RTP, FedNow, and wire.
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

      </div>
    </main>
  );
}
