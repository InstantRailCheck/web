import type { TriageRow } from "@/lib/riskTriage";
import { ModerateDeleteButton } from "@/components/ModerateDeleteButton";
import { ReviewFlagButton } from "@/components/ReviewFlagButton";

const SEVERITY_STYLES: Record<string, string> = {
  high: "border-red-900/60 bg-red-950/30 text-red-300",
  warning: "border-amber-900/60 bg-amber-950/30 text-amber-300",
  info: "border-slate-700 bg-slate-900 text-slate-400",
};

function formatTimestamp(iso: string): string {
  return iso.replace("T", " ").replace(/\.\d+Z$/, "Z");
}

function FlagDetail({ row }: { row: TriageRow }) {
  if (row.table === "route_reports") {
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
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col text-sm text-slate-200">
      <span>{row.bankName}</span>
      <span className="text-xs text-slate-400">
        {row.daysEarly} day{row.daysEarly !== 1 ? "s" : ""} early
      </span>
    </div>
  );
}

function ComparisonList({ row }: { row: TriageRow }) {
  if (row.table !== "route_reports" || row.comparison.length === 0) return null;
  return (
    <details className="mt-2 text-xs text-slate-400">
      <summary className="cursor-pointer text-slate-500 hover:text-slate-300">
        Compare with {row.comparison.length} other recent report{row.comparison.length === 1 ? "" : "s"} for this route/rail
      </summary>
      <ul className="mt-1 space-y-0.5 pl-4">
        {row.comparison.map((c) => (
          <li key={c.id}>
            {c.status}
            {c.testedAt && ` · tested ${c.testedAt}`}
            {c.settlementTimeMinutes !== null && ` · ${c.settlementTimeMinutes}min`}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function TriageFlagCard({ row }: { row: TriageRow }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900/70 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex-1">
          <FlagDetail row={row} />
          <p className="mt-2 text-xs text-slate-500">
            {formatTimestamp(row.createdAt)} ·{" "}
            {row.userId ? (
              <a href={`/admin/moderation/users/${row.userId}`} className="text-blue-400 hover:text-blue-300 transition">
                view submitter
              </a>
            ) : (
              "anonymized"
            )}{" "}
            · id: {row.id}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2 sm:items-end">
          <ModerateDeleteButton targetTable={row.table} targetId={row.id} />
          {row.userId && <ReviewFlagButton targetTable={row.table} targetId={row.id} subjectUserId={row.userId} signals={row.signals} score={row.score} />}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        {row.signals.map((s, i) => (
          <span key={i} className={`w-fit rounded-full border px-2 py-0.5 text-xs ${SEVERITY_STYLES[s.severity]}`}>
            {s.reason}
          </span>
        ))}
      </div>

      <ComparisonList row={row} />
    </div>
  );
}
