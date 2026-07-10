import { SiteFooterLinks } from "@/components/SiteFooterLinks";

export const dynamic = "force-static";

export default function MethodologyPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex w-full max-w-3xl flex-col px-6 pt-10 pb-16">
        <h1 className="text-center text-3xl font-bold">Methodology</h1>
        <p className="mt-1 text-center text-sm text-slate-500">Last updated July 8, 2026.</p>
        <p className="mt-2 text-center text-sm text-slate-400">
          How InstantRailCheck sources, verifies, and scores the data behind every route.
        </p>

        <div className="mt-8 space-y-10 text-sm leading-relaxed text-slate-300">
          <section>
            <h2 className="text-lg font-semibold text-white">Core principles</h2>
            <ul className="mt-3 list-disc space-y-1.5 pl-5">
              <li>Real-world reports only — no simulated or estimated data</li>
              <li>No guessing — a low-confidence match is treated as no match</li>
              <li>Unknown is better than wrong — a blank field beats an incorrect one</li>
              <li>Test dates are always shown, and stale data is marked stale</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">Where institution data comes from</h2>
            <p className="mt-2">
              Bank and credit union contact info (website, address, phone) comes from official
              regulatory sources, not self-reported by users:
            </p>
            <ul className="mt-3 list-disc space-y-1.5 pl-5">
              <li><strong className="text-slate-100">Banks</strong> — FDIC BankFind (website, address)</li>
              <li><strong className="text-slate-100">Credit unions</strong> — NCUA&apos;s quarterly call report data (website, address, phone); no live API exists for this, so it&apos;s synced periodically from NCUA&apos;s bulk data files</li>
              <li><strong className="text-slate-100">Brokerages</strong> — FINRA BrokerCheck (address, phone only — no official website field exists for broker-dealers in any regulatory source we checked)</li>
            </ul>
            <p className="mt-3">
              Matching a user-entered institution name against these sources never guesses. If a
              name is ambiguous enough to plausibly match more than one real institution, it&apos;s
              treated as no match rather than picking one — a missing field is always safer than
              a wrong one.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">Payment rail verification</h2>
            <p className="mt-2">Each rail is verified differently, based on what&apos;s actually available:</p>
            <ul className="mt-3 list-disc space-y-1.5 pl-5">
              <li><strong className="text-slate-100">FedNow</strong> — checked against the Federal Reserve&apos;s official participant list</li>
              <li><strong className="text-slate-100">RTP</strong> — checked against The Clearing House&apos;s official participant list</li>
              <li>
                <strong className="text-slate-100">Zelle</strong> — checked against Zelle&apos;s own partner
                directory, which is confirmed to be incomplete (a genuine Zelle-supporting bank
                can be absent from it). A missing Zelle badge means &quot;not listed,&quot; not &quot;confirmed
                unsupported.&quot;
              </li>
              <li><strong className="text-slate-100">ACH, Wire, Visa Direct, Mastercard Send</strong> — no accessible official directory exists for any of these, so they&apos;re tracked entirely from user-submitted route reports</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">Name-matching, precisely</h2>
            <p className="mt-2">
              Verifying rail participation means matching an institution&apos;s name against an
              official participant list — harder than it sounds, since official lists use full
              legal names (&quot;Capital One, National Association&quot;) while most people think in brand
              names (&quot;Capital One&quot;). The matcher tries progressively shorter prefixes of a name,
              but only trusts a substring match on the complete, untruncated name — and only if
              it resolves to exactly one distinct institution.
            </p>
            <p className="mt-2">
              That last part matters: a generic word like &quot;Farmers&quot; legitimately appears in two
              dozen unrelated &quot;Farmers ... Bank&quot; entities across official lists. Matching on it
              would produce a confident-looking but essentially random result. Multiple matches
              are treated as ambiguous — not a guess, no match.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">Confidence levels</h2>
            <p className="mt-2">Every route result shows a confidence level based on report volume:</p>
            <ul className="mt-3 list-disc space-y-1.5 pl-5">
              <li><strong className="text-green-400">HIGH</strong> — more than 50 reports</li>
              <li><strong className="text-yellow-400">MEDIUM</strong> — more than 10 reports</li>
              <li><strong className="text-slate-400">LOW</strong> — 10 or fewer reports</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">Corrections never override confirmed data</h2>
            <p className="mt-2">
              Automated re-syncs against official sources never downgrade a rail flag that&apos;s
              already confirmed true — a positive confirmation (even a manual correction) always
              outweighs a later absence in a source that can itself be incomplete, like Zelle&apos;s
              directory. User-suggested corrections to a bank&apos;s website or phone are re-verified
              against the same official sources before being applied; a match auto-applies, a
              mismatch is flagged for review instead of trusted blindly.
            </p>
          </section>
        </div>

        <SiteFooterLinks />
      </div>
    </main>
  );
}
