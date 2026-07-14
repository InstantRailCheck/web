import "server-only";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { resolveDirectoryPage } from "@/lib/seo";
import {
  fetchModerationPage,
  MODERATION_PAGE_SIZE,
  MODERATION_TARGET_TABLES,
  type ModerationTargetTable,
  type ModerationRow,
} from "@/lib/moderation";
import { depositTypeLabel, payrollProviderLabel } from "@/lib/eddContext";
import { ModerateDeleteButton } from "@/components/ModerateDeleteButton";
import { UserLookupForm } from "@/components/UserLookupForm";

export const dynamic = "force-dynamic";

const TAB_LABELS: Record<ModerationTargetTable, string> = {
  route_reports: "Route reports",
  edd_reports: "EDD reports",
  route_requests: "Route requests",
};

function isModerationTargetTable(value: string | undefined): value is ModerationTargetTable {
  return MODERATION_TARGET_TABLES.includes(value as ModerationTargetTable);
}

// Deterministic, UTC, second-precision — this is an audit surface, not a
// friendly relative-time display like /changelog's timeAgo().
function formatTimestamp(iso: string): string {
  return iso.replace("T", " ").replace(/\.\d+Z$/, "Z");
}

function buildPageUrl(type: ModerationTargetTable, q: string, page: number): string {
  const usp = new URLSearchParams();
  usp.set("type", type);
  if (q) usp.set("q", q);
  if (page > 1) usp.set("page", String(page));
  return `/admin/moderation?${usp.toString()}`;
}

function RowDetail({ row }: { row: ModerationRow }) {
  if (row.type === "route_reports") {
    return (
      <div className="flex flex-col text-sm text-slate-200">
        <span>
          {row.fromBankName} → {row.toBankName}
          {row.direction && <span className="text-slate-500"> · {row.direction}</span>}
        </span>
        <span className="text-xs text-slate-400">
          {row.railUsed ?? "Unknown rail"} · {row.status}
          {row.testedAt && ` · tested ${row.testedAt}`}
          {row.settlementTimeMinutes !== null && ` · ${row.settlementTimeMinutes}min`}
          {row.sameDay !== null && (row.sameDay ? " · same-day" : " · not same-day")}
        </span>
        {row.notes && <span className="mt-1 text-xs text-slate-500">&ldquo;{row.notes}&rdquo;</span>}
      </div>
    );
  }

  if (row.type === "edd_reports") {
    return (
      <div className="flex flex-col text-sm text-slate-200">
        <span>{row.bankName}</span>
        <span className="text-xs text-slate-400">
          {row.daysEarly} day{row.daysEarly !== 1 ? "s" : ""} early
          {row.depositType && ` · ${depositTypeLabel(row.depositType) ?? row.depositType}`}
          {row.payrollProvider && ` · ${payrollProviderLabel(row.payrollProvider) ?? row.payrollProvider}`}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col text-sm text-slate-200">
      <span>
        {row.fromBankName} → {row.toBankName}
      </span>
      <span className="text-xs text-slate-400">{row.fulfilledAt ? `Fulfilled ${row.fulfilledAt}` : "Active"}</span>
    </div>
  );
}

function ModerationRowCard({ row }: { row: ModerationRow }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900/70 p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex-1">
        <RowDetail row={row} />
        <p className="mt-2 text-xs text-slate-500">
          {formatTimestamp(row.createdAt)} ·{" "}
          {row.attributable && row.userId ? (
            <a href={`/admin/moderation/users/${row.userId}`} className="text-blue-400 hover:text-blue-300 transition">
              attributable
            </a>
          ) : (
            "anonymized"
          )}{" "}
          · id: {row.id}
        </p>
      </div>
      <ModerateDeleteButton targetTable={row.type} targetId={row.id} />
    </div>
  );
}

type SearchParams = { type?: string; q?: string; page?: string };

export default async function AdminModerationPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  // Independent of the admin nav simply not linking here — an unauthorized
  // visitor gets a plain 404, no signal an admin surface exists at all.
  const admin = await requireAdmin();
  if (!admin) notFound();

  const { type: typeParam, q: qParam, page: pageParam } = await searchParams;
  const type: ModerationTargetTable = isModerationTargetTable(typeParam) ? typeParam : "route_reports";
  const q = qParam ?? "";
  const page = resolveDirectoryPage(pageParam);

  const { rows, total } = await fetchModerationPage(type, page, q);
  const totalPages = Math.max(1, Math.ceil(total / MODERATION_PAGE_SIZE));

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex w-full max-w-4xl flex-col px-6 pt-10 pb-16">
        <h1 className="text-center text-3xl font-bold">Moderation</h1>
        <p className="mt-1 text-center text-sm text-slate-400">
          Remove spam, fabricated, duplicate, or privacy-flagged community submissions.
        </p>
        <p className="mt-1 text-center text-sm">
          <a href="/admin/moderation/triage" className="text-blue-400 hover:text-blue-300 transition">
            View flagged submissions →
          </a>
        </p>

        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {MODERATION_TARGET_TABLES.map((t) => (
            <a
              key={t}
              href={buildPageUrl(t, q, 1)}
              className={`rounded-full border px-4 py-1.5 text-sm font-medium transition ${
                t === type
                  ? "border-blue-500 bg-blue-950/40 text-white"
                  : "border-slate-700 text-slate-400 hover:border-slate-600"
              }`}
            >
              {TAB_LABELS[t]}
            </a>
          ))}
        </div>

        <UserLookupForm />

        <form method="get" className="mt-4 flex justify-center gap-2">
          <input type="hidden" name="type" value={type} />
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="Filter by bank name"
            className="w-64 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
          />
          <button
            type="submit"
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-slate-800"
          >
            Filter
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-slate-500">
          {total} result{total !== 1 ? "s" : ""}
        </p>

        <div className="mt-4 grid gap-2">
          {rows.length === 0 ? (
            <p className="text-center text-sm text-slate-500">No submissions match.</p>
          ) : (
            rows.map((row) => <ModerationRowCard key={row.id} row={row} />)
          )}
        </div>

        {totalPages > 1 && (
          <div className="mt-6 flex items-center justify-center gap-4 text-sm">
            {page > 1 ? (
              <a href={buildPageUrl(type, q, page - 1)} className="text-blue-400 hover:text-blue-300 transition">
                ← Previous
              </a>
            ) : (
              <span className="text-slate-700">← Previous</span>
            )}
            <span className="text-slate-500">
              Page {page} of {totalPages}
            </span>
            {page < totalPages ? (
              <a href={buildPageUrl(type, q, page + 1)} className="text-blue-400 hover:text-blue-300 transition">
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
