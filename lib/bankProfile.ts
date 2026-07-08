import { createClient } from "@/lib/supabase/server";

const STALE_DAYS = 180;

type RailStats = {
  rail: string;
  count: number;
  successRate: number;
  avgTime: number | null;
  lastTested: string | null;
  isStale: boolean;
};

export type BankProfile = {
  bank: {
    id: string;
    name: string;
    website: string | null;
    address: string | null;
    phone: string | null;
    fednow_participant: boolean | null;
    rtp_participant: boolean | null;
    zelle_participant: boolean | null;
  } | null;
  sending: RailStats[];
  receiving: RailStats[];
};

export async function getBankProfile(bankId: string): Promise<BankProfile> {
  const supabase = await createClient();

  const [{ data: bank }, { data: reports }] = await Promise.all([
    supabase
      .from("banks")
      .select("id, name, website, address, phone, fednow_participant, rtp_participant, zelle_participant")
      .eq("id", bankId)
      .maybeSingle(),
    supabase
      .from("route_reports")
      .select("*")
      .or(`from_bank_id.eq.${bankId},to_bank_id.eq.${bankId}`),
  ]);

  const sendingRows = (reports ?? []).filter((r) => r.from_bank_id === bankId);
  const receivingRows = (reports ?? []).filter((r) => r.to_bank_id === bankId);

  return {
    bank: bank ?? null,
    sending: summarizeByRail(sendingRows),
    receiving: summarizeByRail(receivingRows),
  };
}

function summarizeByRail(rows: any[]): RailStats[] {
  const rails = Array.from(new Set(rows.map((r) => r.rail_used || "unknown")));

  return rails.map((rail) => {
    const railRows = rows.filter((r) => (r.rail_used || "unknown") === rail);
    const successCount = railRows.filter((r) => r.status === "success").length;

    const timingRows = railRows.filter((r) => r.settlement_time_minutes != null);
    const avgTime =
      timingRows.length > 0
        ? Math.round(
            timingRows.reduce((acc, r) => acc + r.settlement_time_minutes, 0) /
              timingRows.length
          )
        : null;

    const dates = railRows
      .map((r) => r.tested_at as string | null)
      .filter((d): d is string => !!d)
      .sort()
      .reverse();

    const lastTested = dates[0] ?? null;
    const isStale = lastTested
      ? daysBetween(lastTested, new Date().toISOString().split("T")[0]) > STALE_DAYS
      : false;

    return {
      rail,
      count: railRows.length,
      successRate: successCount / railRows.length,
      avgTime,
      lastTested,
      isStale,
    };
  });
}

function daysBetween(a: string, b: string): number {
  return Math.abs(
    (new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60 * 24)
  );
}
