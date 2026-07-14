import "server-only";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { resolveDirectoryPage } from "@/lib/seo";
import { fetchTriageQueue, TRIAGE_PAGE_SIZE, type TriageTableFilter } from "@/lib/riskTriage";
import type { Severity, SignalType } from "@/lib/riskSignals";
import { TriageFlagCard } from "@/components/TriageFlagCard";

export const dynamic = "force-dynamic";

const SEVERITY_OPTIONS: Severity[] = ["info", "warning", "high"];
const SIGNAL_OPTIONS: SignalType[] = [
  "velocity",
  "new_reporter_high_volume",
  "duplicate",
  "consensus_conflict",
  "settlement_time_outlier",
  "moderation_history",
  "official_source_mismatch",
];

const SIGNAL_LABELS: Record<SignalType, string> = {
  velocity: "Velocity",
  new_reporter_high_volume: "New reporter, high volume",
  duplicate: "Duplicate",
  consensus_conflict: "Consensus conflict",
  settlement_time_outlier: "Settlement time outlier",
  moderation_history: "Moderation history",
  official_source_mismatch: "Official-source mismatch",
};

function isSeverity(v: string | undefined): v is Severity {
  return SEVERITY_OPTIONS.includes(v as Severity);
}

function isTableFilter(v: string | undefined): v is TriageTableFilter {
  return v === "route_reports" || v === "edd_reports" || v === "all";
}

type SearchParams = {
  table?: string;
  severity?: string;
  signals?: string | string[];
  bank?: string;
  account?: string;
  from?: string;
  to?: string;
  reviewed?: string;
  page?: string;
};

function toArray(v: string | string[] | undefined): string[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function buildPageUrl(params: SearchParams, page: number): string {
  const usp = new URLSearchParams();
  if (params.table) usp.set("table", params.table);
  if (params.severity) usp.set("severity", params.severity);
  for (const s of toArray(params.signals)) usp.append("signals", s);
  if (params.bank) usp.set("bank", params.bank);
  if (params.account) usp.set("account", params.account);
  if (params.from) usp.set("from", params.from);
  if (params.to) usp.set("to", params.to);
  if (params.reviewed) usp.set("reviewed", params.reviewed);
  if (page > 1) usp.set("page", String(page));
  return `/admin/moderation/triage?${usp.toString()}`;
}

export default async function AdminTriagePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const admin = await requireAdmin();
  if (!admin) notFound();

  const params = await searchParams;
  const table: TriageTableFilter = isTableFilter(params.table) ? params.table : "all";
  const minSeverity: Severity = isSeverity(params.severity) ? params.severity : "info";
  const selectedSignals = toArray(params.signals).filter((s): s is SignalType => SIGNAL_OPTIONS.includes(s as SignalType));
  const bankFilter = params.bank ?? "";
  const accountFilter = params.account?.trim() || null;
  const showReviewed = params.reviewed === "1";
  const page = resolveDirectoryPage(params.page);

  const { rows, total } = await fetchTriageQueue({
    page,
    table,
    minSeverity,
    signalTypes: selectedSignals.length > 0 ? selectedSignals : null,
    bankFilter,
    accountFilter,
    dateFrom: params.from ? new Date(params.from).toISOString() : null,
    dateTo: params.to ? new Date(params.to).toISOString() : null,
    showReviewed,
  });
  const totalPages = Math.max(1, Math.ceil(total / TRIAGE_PAGE_SIZE));

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex w-full max-w-4xl flex-col px-6 pt-10 pb-16">
        <h1 className="text-center text-3xl font-bold">Triage</h1>
        <p className="mt-1 text-center text-sm text-slate-400">
          <a href="/admin/moderation" className="text-blue-400 hover:text-blue-300 transition">
            ← Back to moderation
          </a>
        </p>

        <div className="mt-6 rounded-lg border border-blue-900/50 bg-blue-950/20 p-4 text-sm text-blue-200">
          These are review signals, not proof of abuse. Legitimate transfer results can conflict due to timing, direction, account
          type, limits, and bank-specific behavior. Nothing here removes content or acts on an account automatically — use the
          existing remove/restrict/suspend/ban controls after review.
        </div>

        <form method="get" className="mt-6 flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900/50 p-4">
          <div className="flex flex-wrap gap-3">
            <label className="text-xs text-slate-400">
              Table
              <select name="table" defaultValue={table} className="mt-1 block rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-white">
                <option value="all">All</option>
                <option value="route_reports">Route reports</option>
                <option value="edd_reports">EDD reports</option>
              </select>
            </label>
            <label className="text-xs text-slate-400">
              Minimum severity
              <select
                name="severity"
                defaultValue={minSeverity}
                className="mt-1 block rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-white"
              >
                {SEVERITY_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-400">
              Bank/route
              <input
                type="text"
                name="bank"
                defaultValue={bankFilter}
                placeholder="Bank name"
                className="mt-1 block w-40 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-white"
              />
            </label>
            <label className="text-xs text-slate-400">
              Account UUID
              <input
                type="text"
                name="account"
                defaultValue={accountFilter ?? ""}
                placeholder="user id"
                className="mt-1 block w-40 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-white"
              />
            </label>
            <label className="text-xs text-slate-400">
              From
              <input
                type="date"
                name="from"
                defaultValue={params.from ?? ""}
                className="mt-1 block rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-white"
              />
            </label>
            <label className="text-xs text-slate-400">
              To
              <input
                type="date"
                name="to"
                defaultValue={params.to ?? ""}
                className="mt-1 block rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-white"
              />
            </label>
          </div>

          <fieldset className="flex flex-wrap gap-3">
            <legend className="mb-1 text-xs text-slate-400">Signal types (all if none selected)</legend>
            {SIGNAL_OPTIONS.map((s) => (
              <label key={s} className="flex items-center gap-1 text-xs text-slate-300">
                <input type="checkbox" name="signals" value={s} defaultChecked={selectedSignals.includes(s)} />
                {SIGNAL_LABELS[s]}
              </label>
            ))}
          </fieldset>

          <label className="flex items-center gap-1 text-xs text-slate-300">
            <input type="checkbox" name="reviewed" value="1" defaultChecked={showReviewed} />
            Show already-reviewed flags
          </label>

          <button
            type="submit"
            className="w-fit rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-slate-800"
          >
            Apply filters
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-slate-500">
          {total} flagged submission{total !== 1 ? "s" : ""}
        </p>

        <div className="mt-4 grid gap-3">
          {rows.length === 0 ? (
            <p className="text-center text-sm text-slate-500">No submissions currently match these filters.</p>
          ) : (
            rows.map((row) => <TriageFlagCard key={`${row.table}:${row.id}`} row={row} />)
          )}
        </div>

        {totalPages > 1 && (
          <div className="mt-6 flex items-center justify-center gap-4 text-sm">
            {page > 1 ? (
              <a href={buildPageUrl(params, page - 1)} className="text-blue-400 hover:text-blue-300 transition">
                ← Previous
              </a>
            ) : (
              <span className="text-slate-700">← Previous</span>
            )}
            <span className="text-slate-500">
              Page {page} of {totalPages}
            </span>
            {page < totalPages ? (
              <a href={buildPageUrl(params, page + 1)} className="text-blue-400 hover:text-blue-300 transition">
                Next →
              </a>
            ) : (
              <span className="text-slate-700">Next →</span>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
