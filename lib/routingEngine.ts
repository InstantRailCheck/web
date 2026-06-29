import { supabase } from "@/lib/supabase";

type RailStats = {
  rail: string;
  count: number;
  successRate: number;
  avgTime: number | null;
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

  const railsMap: Record<string, RailStats> = {};

  for (const row of data) {
    const rail = row.rail_used || "unknown";
    if (!railsMap[rail]) {
      railsMap[rail] = { rail, count: 0, successRate: 0, avgTime: null };
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

    return {
      rail: r.rail,
      count: r.count,
      successRate: successCount / rows.length,
      avgTime,
    };
  });

  const total = data.length;
  const confidence = total > 50 ? "HIGH" : total > 10 ? "MEDIUM" : "LOW";

  return { rails, confidence, sampleSize: total };
}