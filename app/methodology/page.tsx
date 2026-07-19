import { LegalFooterLinks } from "@/components/LegalFooterLinks";

export const dynamic = "force-static";

export default function MethodologyPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex w-full max-w-3xl flex-col px-6 pt-10 pb-16">
        <h1 className="text-center text-3xl font-bold">Methodology</h1>
        <p className="mt-1 text-center text-sm text-slate-500">Last updated July 19, 2026.</p>
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
            <p className="mt-3">
              InstantRailCheck is an independent service. References to FDIC, NCUA, the Federal
              Reserve, The Clearing House, Zelle, and listed financial institutions identify data
              sources or payment networks only; they do not imply affiliation, endorsement,
              sponsorship, or approval.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">Institution names, aliases, and source attribution</h2>
            <p className="mt-2">
              Which regulator an institution&apos;s contact info is sourced from (shown on its
              profile page) is decided by that institution&apos;s actual regulatory record — never
              guessed from wording in its name. A credit union whose name doesn&apos;t happen to
              contain the words &quot;credit union&quot; is still correctly labeled as NCUA-sourced.
            </p>
            <p className="mt-3">
              Regulators&apos; own raw source files sometimes include a self-registered trade name
              or alternate name for an institution. That data isn&apos;t automatically shown as a
              public &quot;also known as&quot; alias just because it appears in an official file — it&apos;s
              checked first for a genuine relationship to the institution&apos;s real name.
              Alternate names that instead name an unrelated, unaffiliated company are suppressed
              from public display, even though the raw source data remains available for internal
              audit and search purposes. An institution&apos;s own legitimate abbreviation or
              acronym (verified independently, not assumed) can still be shown.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">Payment rail verification</h2>
            <p className="mt-2">Each rail is verified differently, based on what&apos;s actually available:</p>
            <ul className="mt-3 list-disc space-y-1.5 pl-5">
              <li><strong className="text-slate-100">FedNow</strong> — checked against the Federal Reserve&apos;s official participant list</li>
              <li><strong className="text-slate-100">RTP</strong> — checked against The Clearing House&apos;s official participant list</li>
              <li>
                <strong className="text-slate-100">P2P - Zelle</strong>{" "}
                — checked against Zelle&apos;s own partner directory, which is confirmed to be
                incomplete (a genuine Zelle-supporting bank can be absent from it). A missing badge
                means &quot;not listed,&quot; not &quot;confirmed unsupported.&quot;
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
            <h2 className="text-lg font-semibold text-white">Route evidence</h2>
            <p className="mt-2">
              Every searched route shows evidence rather than a single numeric confidence score.
              Only reports from a signed-in account count, and only each reporter&apos;s newest
              report for a given directional route (sending bank → receiving bank) and rail —
              submitting the same report repeatedly can&apos;t inflate it. The reverse direction
              (receiving bank → sending bank) is tracked as a completely separate route, since
              rail support and timing aren&apos;t guaranteed to be symmetric.
            </p>
            <p className="mt-2">
              Only reports from the last 180 days count toward an active evidence state. If every
              report for a route is older than that, it&apos;s shown as{" "}
              <strong className="text-slate-200">Previously observed</strong>{" "}
              rather than disappearing — the evidence still exists, it&apos;s just no longer treated as current.
            </p>
            <p className="mt-2">A route&apos;s evidence state is one of:</p>
            <ul className="mt-3 list-disc space-y-1.5 pl-5">
              <li><strong className="text-slate-100">Limited evidence</strong> — exactly one reporter within the last 180 days</li>
              <li><strong className="text-slate-100">Observed working</strong> — two reporters within 180 days, all successful</li>
              <li><strong className="text-slate-100">Consistently reported</strong> — three or more reporters within 180 days, all successful</li>
              <li><strong className="text-slate-100">Variable timing</strong> — a mix of successful and delayed reports, no failures</li>
              <li><strong className="text-slate-100">Reported delayed</strong> — every recent report was delayed</li>
              <li><strong className="text-slate-100">Reported unsuccessful</strong> — every recent report failed</li>
              <li><strong className="text-slate-100">Conflicting reports</strong> — recent reports disagree (at least one failure alongside a success or delay)</li>
              <li><strong className="text-slate-100">Previously observed</strong> — evidence exists, but all of it is older than 180 days</li>
            </ul>
            <p className="mt-3">
              These states describe what&apos;s been observed and reported — not a guarantee of
              what will happen on your own transfer.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">Early Direct Deposit leaderboard</h2>
            <p className="mt-2">
              The <a href="/early-direct-deposit" className="underline decoration-slate-600 underline-offset-2 hover:text-white hover:decoration-slate-400 transition">Early Direct Deposit leaderboard</a>{" "}
              ranks institutions by how early community members have reported their direct
              deposits arriving. Only each reporter&apos;s newest report per institution counts, and
              inactive institutions never appear regardless of how much historical evidence they
              have.
            </p>
            <p className="mt-2">
              A ranked position requires at least 5 distinct reporters for that institution; 2-4
              reporters appear only in an unranked &quot;early evidence&quot; section, not the
              ranked leaderboard. The headline number is the{" "}
              <strong className="text-slate-200">typical (median)</strong>{" "}
              reported timing, not a raw average — a single report of
              &quot;more than 5 days early&quot; is a real observation, not an unbounded exact count, so
              it&apos;s never averaged in as though it meant literally six days. When the typical
              value would need to reflect one of those open-ended reports, it&apos;s shown in plain
              language (&quot;more than 5 days early&quot;) instead of a fabricated number.
            </p>
            <p className="mt-2">
              Each ranked institution shows a sample-size label reflecting how much evidence
              backs it — not certainty: <strong className="text-slate-100">Emerging evidence</strong>{" "}
              (5-9 reporters), <strong className="text-slate-100">Moderate evidence</strong>{" "}
              (10-24), <strong className="text-slate-100">Strong evidence</strong> (25+) — plus the
              date of the most recent qualifying report, marked stale if none has come in within
              180 days.
            </p>
            <p className="mt-2">
              Direct deposit timing ultimately depends on when an employer, benefits agency, or
              payroll provider sends the payment file — a bank&apos;s past timing doesn&apos;t
              guarantee your own deposit will arrive at the reported time.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">Settlement-time leaderboard</h2>
            <p className="mt-2">
              The <a href="/timing" className="underline decoration-slate-600 underline-offset-2 hover:text-white hover:decoration-slate-400 transition">settlement-time leaderboard</a>{" "}
              ranks institutions separately by rail and by which side sent the transfer, using the{" "}
              <strong className="text-slate-200">typical (median)</strong>{" "}
              settlement time rather than a raw average, for the same reason as Early Direct Deposit: a single unusually
              slow (or fast) report shouldn&apos;t be able to swing the headline number the way it
              would swing an average.
            </p>
            <p className="mt-2">
              Failed transfers and invalid negative values are excluded entirely — they don&apos;t
              have a meaningful settlement time. A delayed-but-eventually-completed transfer still
              counts, since it did settle, just later than expected. As with route evidence, only
              each reporter&apos;s newest report for a given directional route and rail counts, at
              least 2 distinct reporters are required for an institution to appear, and inactive
              institutions are excluded. Ties are broken deterministically (fastest typical time,
              then consistency, then sample size, then name), and the same sample-size evidence
              labels and 180-day staleness marking used for Early Direct Deposit apply here too.
            </p>
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

        <LegalFooterLinks />
      </div>
    </main>
  );
}
