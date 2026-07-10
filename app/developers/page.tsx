import Link from "next/link";
import { API_URL } from "@/lib/siteConfig";
import { LegalFooterLinks } from "@/components/LegalFooterLinks";
import { EVIDENCE_LABELS } from "@/lib/routeConfidence";

const EVIDENCE_DESCRIPTIONS: Record<keyof typeof EVIDENCE_LABELS, string> = {
  limited_evidence: "Exactly one attributable reporter within the last 180 days.",
  observed_working: "Two attributable reporters within 180 days, all successful.",
  consistently_reported: "Three or more attributable reporters within 180 days, all successful.",
  reported_unsuccessful: "Every attributable report within 180 days failed.",
  reported_delayed: "Every attributable report within 180 days was delayed.",
  variable_timing: "A mix of successful and delayed attributable reports within 180 days, with no failures.",
  conflicting: "Attributable reports within 180 days disagree — at least one failure alongside a success or delay.",
  previously_observed: "Attributable evidence exists, but all of it is older than 180 days.",
};

export const dynamic = "force-dynamic";

const ENDPOINTS = [
  {
    method: "GET",
    path: "/banks",
    description: "List all banks. Optional ?q= to search by name. Add &format=csv for CSV instead of JSON.",
    example: "/banks?q=chase",
  },
  {
    method: "GET",
    path: "/banks/:id",
    description:
      "Full profile for one bank: contact info, network participation, and per-rail evidence sending/receiving (attributable report counts by outcome, distinct routes observed, latest observation date — no success percentage).",
    example: "/banks/c681154f-c3c4-4f50-9031-a05c79b2d152",
  },
  {
    method: "GET",
    path: "/routes",
    description:
      "Evidence between two specific banks, per rail. Requires ?from= and ?to= bank ids. Only rails with at least one attributable (signed-in, non-duplicate) report are included — see the evidence states below.",
    example: "/routes?from=<bank-id>&to=<bank-id>",
  },
  {
    method: "GET",
    path: "/changelog",
    description: "Recent activity feed — banks added and route reports submitted. Optional ?limit= (max 200, default 50). Add &format=csv for CSV instead of JSON.",
    example: "/changelog?limit=10",
  },
];

export default function DevelopersPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex w-full max-w-4xl flex-col px-6 pt-10 pb-16">
        <h1 className="text-center text-3xl font-bold">API</h1>
        <p className="mt-1 text-center text-sm text-slate-400">
          Read-only, unauthenticated, and CORS-enabled — free to use in your own tools.
          Responses are JSON by default; list endpoints also support <code>&amp;format=csv</code>.
          Every response includes an <code>X-Api-Version</code> header, bumped whenever a
          documented response shape changes.
        </p>

        <div className="mt-8 space-y-6">
          {ENDPOINTS.map((ep) => (
            <div key={ep.path} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
              <div className="flex items-center gap-3">
                <span className="rounded bg-green-500/10 px-2 py-0.5 text-xs font-semibold text-green-400">
                  {ep.method}
                </span>
                <code className="text-sm text-slate-100">{ep.path}</code>
              </div>
              <p className="mt-2 text-sm text-slate-400">{ep.description}</p>
              <code className="mt-3 block rounded-lg bg-slate-950 p-3 text-xs text-slate-500">
                GET {API_URL}{ep.example}
              </code>
            </div>
          ))}
        </div>

        <div className="mt-10 rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <h2 className="text-lg font-semibold">Route evidence states</h2>
          <p className="mt-2 text-sm text-slate-400">
            <code>/routes</code> and <code>/banks/:id</code> describe evidence rather than a
            single confidence score. A report only counts if it&apos;s from a signed-in user
            (unattributed/legacy rows never count), and only each reporter&apos;s newest report
            for a given route and rail is used — so one person can&apos;t inflate the count.
            A route or rail with no attributable reports is simply absent from the response,
            not marked with a &quot;none&quot; state.
          </p>
          <dl className="mt-4 space-y-2 text-sm">
            {(Object.keys(EVIDENCE_LABELS) as (keyof typeof EVIDENCE_LABELS)[]).map((state) => (
              <div key={state} className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
                <dt className="shrink-0 font-medium text-slate-200 sm:w-48">{EVIDENCE_LABELS[state]}</dt>
                <dd className="text-slate-400">{EVIDENCE_DESCRIPTIONS[state]}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="mt-10 rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <h2 className="text-lg font-semibold">Early Direct Deposit evidence</h2>
          <p className="mt-2 text-sm text-slate-400">
            <code>/banks/:id</code>&apos;s <code>eddEvidence</code> is <code>null</code> until at
            least 2 distinct signed-in reporters have reported early direct deposit for that
            bank (same one-report-per-reporter rule as route evidence). When present, it includes{" "}
            <code>avgDaysEarly</code>, <code>reportCount</code>, <code>hasMoreThanFive</code>{" "}
            (some reporters selected &quot;more than 5 days&quot;, so the average understates
            reality), and <code>providers</code>.
          </p>
          <p className="mt-2 text-sm text-slate-400">
            Reporters can optionally note what kind of deposit it was and which payroll platform
            or provider paid it. <code>providers</code> breaks out bank-wide EDD evidence by
            provider (e.g. &quot;ADP payroll deposits were reported 2 days early by 6 distinct
            reporters&quot;), but only once a provider has <strong className="text-slate-300">3</strong>{" "}
            distinct reporters — a higher bar than overall <code>eddEvidence</code>, since naming a
            specific company is more identifying. A provider below that threshold is simply
            absent from the array, not included as a zero-count entry. Deposit types that
            aren&apos;t payroll (government benefits, tax refunds, pensions) never contribute to a
            provider&apos;s count, even if a provider was recorded alongside them.
          </p>
        </div>

        <div className="mt-10 rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <h2 className="text-lg font-semibold">v6 breaking change</h2>
          <p className="mt-2 text-sm text-slate-400">
            <code>/routes</code>&apos; <code>confidence</code>{" "}
            (a raw report-count threshold) and every rail&apos;s{" "}
            <code>successRate</code> were removed — both could reach a
            precise-looking number or a HIGH/MEDIUM/LOW label from unattributed or single-report
            data. <code>/banks/:id</code>&apos;s per-rail <code>successRate</code> was removed
            for the same reason. Both now expose an <code>evidence</code> object (or, on{" "}
            <code>/banks/:id</code>, attributable/successful/delayed/unsuccessful report counts
            and distinct-route counts) instead — see the evidence states above.
          </p>
        </div>

        <div className="mt-10 rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <h2 className="text-lg font-semibold">Webhooks</h2>
          <p className="mt-2 text-sm text-slate-400">
            Rather than polling <code>{API_URL}/changelog</code>, register a URL at{" "}
            <Link href="/webhooks" className="text-blue-400 hover:text-blue-300 transition">
              /webhooks
            </Link>{" "}
            (requires signing in) to get a signed POST whenever a new bank is added. Each
            delivery includes an <code>X-InstantRailCheck-Signature</code> header — HMAC-SHA256
            of the raw request body using the secret shown when you register. Deliveries are
            fire-and-forget with no retry, so your endpoint should respond quickly with a 2xx.
          </p>
        </div>

        <LegalFooterLinks />
      </div>
    </main>
  );
}
