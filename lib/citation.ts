import { formatMonthYear } from "@/lib/utils";

// The "Data verified" clause is dropped entirely (not shown with a blank or
// placeholder date) when dateModified is null — the same "blank over wrong"
// pattern used everywhere else on this page. The citation still works
// without it (organization, title, URL), just without a claimed
// verification date.
export function buildCoverageReportCitation(input: { dateModified: string | null; url: string }): string {
  const verifiedClause = input.dateModified ? ` Data verified ${formatMonthYear(input.dateModified)}.` : "";
  return `InstantRailCheck. "U.S. Instant Payments Coverage."${verifiedClause} ${input.url}`;
}
