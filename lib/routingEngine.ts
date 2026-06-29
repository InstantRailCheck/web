import { createClient } from "@/lib/supabase/client";

const STALE_DAYS = 180;

type RailStats = {
  rail: string;
  count: number;
  successRate: number;
  avgTime: number | null;
  lastTested: string | null;
  isStale: boolean;
  directions: ("push" | "pull")[];
};

export type RouteIntelligence = {
  rails: RailStats[];
  confidence: string;
  sampleSize?: number;
  message?: string;
};

export async function getRouteIntelligence(
  fromBankId: string,
  toBankId: string
): Promise<RouteIntelligence> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("route_reports")
    .select("*")
    .eq("from_bank_id", fromBankId)
    .eq("to_bank_id", toBankId);

  if (error || !data || data.length === 0) {
    return {
      rails: [],
      confidence: "LOW",
      message: "No data available yet for this route",
    };
  }

  const railsMap: Record<string, { rail: string; count: number }> = {};

  for (const row of data) {
    const rail = row.rail_used || "unknown";
    if (!railsMap[rail]) {
      railsMap[rail] = { rail, count: 0 };
    }
    railsMap[rail].count += 1;
  }

  const rails: RailStats[] = Object.values(railsMap).map((r) => {
    const rows = data.filter((d) => (d.rail_used || "unknown") === r.rail);
    const successCount = rows.filter((d) => d.status === "success").length;

    const timingRows = rows.filter((d) => d.settlement_time_minutes != null);
    const avgTime =
      timingRows.length > 0
        ? Math.round(
            timingRows.reduce((acc, d) => acc + d.settlement_time_minutes, 0) /
              timingRows.length
          )
        : null;

    const dates = rows
      .map((d) => d.tested_at as string | null)
      .filter((d): d is string => !!d)
      .sort()
      .reverse();

    const lastTested = dates[0] ?? null;
    const isStale = lastTested
      ? daysBetween(lastTested, new Date().toISOString().split("T")[0]) > STALE_DAYS
      : false;

    const directionSet = new Set(
      rows.map((d) => d.direction as string | null).filter((d): d is "push" | "pull" => d === "push" || d === "pull")
    );
    const directions = Array.from(directionSet) as ("push" | "pull")[];

    return {
      rail: r.rail,
      count: r.count,
      successRate: successCount / rows.length,
      avgTime,
      lastTested,
      isStale,
      directions,
    };
  });

  const total = data.length;
  const confidence = total > 50 ? "HIGH" : total > 10 ? "MEDIUM" : "LOW";

  return { rails, confidence, sampleSize: total };
}

function daysBetween(a: string, b: string): number {
  return Math.abs(
    (new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60 * 24)
  );
}
