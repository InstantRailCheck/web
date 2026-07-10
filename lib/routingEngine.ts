import { createClient } from "@/lib/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeRouteEvidence,
  dedupeToNewestPerReporter,
  type RouteEvidence,
  type RouteReportInput,
} from "@/lib/routeConfidence";

type RouteReportRow = {
  rail_used: string | null;
  direction: string | null;
  status: string;
  settlement_time_minutes: number | null;
  tested_at: string | null;
  same_day: boolean | null;
  user_id: string | null;
};

export type RailEvidence = {
  rail: string;
  evidence: RouteEvidence;
  avgTime: number | null;
  directions: ("push" | "pull")[];
  sameDayCount: number | null;
};

export type RouteIntelligence = {
  rails: RailEvidence[];
  message?: string;
};

export async function getRouteIntelligence(
  fromBankId: string,
  toBankId: string,
  supabaseClient?: SupabaseClient
): Promise<RouteIntelligence> {
  const supabase = supabaseClient ?? createClient();
  const { data, error } = await supabase
    .from("route_reports")
    .select("rail_used, direction, status, settlement_time_minutes, tested_at, same_day, user_id")
    .eq("from_bank_id", fromBankId)
    .eq("to_bank_id", toBankId);

  if (error || !data || data.length === 0) {
    return {
      rails: [],
      message: "No data available yet for this route",
    };
  }

  const railGroups = new Map<string, RouteReportRow[]>();
  for (const row of data as RouteReportRow[]) {
    const rail = row.rail_used || "unknown";
    if (!railGroups.has(rail)) railGroups.set(rail, []);
    railGroups.get(rail)!.push(row);
  }

  const rails: RailEvidence[] = [];
  for (const [rail, rows] of railGroups) {
    const asReportInputs: RouteReportInput[] = rows
      .filter((r): r is RouteReportRow & { tested_at: string; status: RouteReportInput["status"] } =>
        !!r.tested_at && (r.status === "success" || r.status === "failed" || r.status === "delayed")
      )
      .map((r) => ({ userId: r.user_id, status: r.status, testedAt: r.tested_at }));

    const evidence = computeRouteEvidence(asReportInputs);
    // A rail with zero attributable reports shows no evidence at all — not
    // even in the list — per "blank over wrong."
    if (!evidence) continue;

    // Secondary stats (timing/direction) are informational, not confidence
    // claims, so they're drawn from every attributable report for this rail
    // rather than narrowed to the same fresh subset behind the evidence state.
    // Still deduped to each reporter's newest, though — otherwise a repeat
    // reporter could inflate avgTime/directions/sameDayCount even though
    // the evidence label above only counted their newest report.
    const attributableRows = rows.filter((r) => r.user_id !== null);
    const statsRows = dedupeToNewestPerReporter(
      attributableRows
        .filter((r): r is RouteReportRow & { tested_at: string } => !!r.tested_at)
        .map((r) => ({ ...r, userId: r.user_id, testedAt: r.tested_at }))
    );

    const timingRows = statsRows.filter((d) => d.settlement_time_minutes != null);
    const avgTime =
      timingRows.length > 0
        ? Math.round(
            timingRows.reduce((acc, d) => acc + (d.settlement_time_minutes ?? 0), 0) / timingRows.length
          )
        : null;

    const directionSet = new Set(
      statsRows.map((d) => d.direction).filter((d): d is "push" | "pull" => d === "push" || d === "pull")
    );

    const sameDayCount = rail === "ACH" ? statsRows.filter((d) => d.same_day === true).length : null;

    rails.push({
      rail,
      evidence,
      avgTime,
      directions: Array.from(directionSet),
      sameDayCount,
    });
  }

  if (rails.length === 0) {
    return { rails: [], message: "No attributable data available yet for this route" };
  }

  return { rails };
}
