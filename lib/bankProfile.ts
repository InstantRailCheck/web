import { createClient } from "@/lib/supabase/server";

const STALE_DAYS = 180;

type RailStats = {
  rail: string;
  count: number;
  successRate: number;
  avgTime: number | null;
  lastTested: string | null;
  isStale: boolean;
  sameDayCount: number | null;
};

export type BankProfile = {
  bank: {
    id: string;
    slug: string;
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

export async function getBankSlugById(id: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("banks").select("slug").eq("id", id).maybeSingle();
  return data?.slug ?? null;
}

export async function getBankProfileBySlug(slug: string): Promise<BankProfile> {
  const supabase = await createClient();
  const { data: bank } = await supabase
    .from("banks")
    .select("id, slug, name, website, address, phone, fednow_participant, rtp_participant, zelle_participant")
    .eq("slug", slug)
    .maybeSingle();

  return buildProfile(bank);
}

// Public API contract (/api/banks/:id) is stable and ID-based — kept
// separate from the slug-based lookup the website itself uses.
export async function getBankProfileById(id: string): Promise<BankProfile> {
  const supabase = await createClient();
  const { data: bank } = await supabase
    .from("banks")
    .select("id, slug, name, website, address, phone, fednow_participant, rtp_participant, zelle_participant")
    .eq("id", id)
    .maybeSingle();

  return buildProfile(bank);
}

async function buildProfile(bank: BankProfile["bank"]): Promise<BankProfile> {
  if (!bank) {
    return { bank: null, sending: [], receiving: [] };
  }

  const supabase = await createClient();
  const { data: reports } = await supabase
    .from("route_reports")
    .select("*")
    .or(`from_bank_id.eq.${bank.id},to_bank_id.eq.${bank.id}`);

  const sendingRows = (reports ?? []).filter((r) => r.from_bank_id === bank.id);
  const receivingRows = (reports ?? []).filter((r) => r.to_bank_id === bank.id);

  return {
    bank,
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

    const sameDayCount = rail === "ACH" ? railRows.filter((r) => r.same_day === true).length : null;

    return {
      rail,
      count: railRows.length,
      successRate: successCount / railRows.length,
      avgTime,
      lastTested,
      isStale,
      sameDayCount,
    };
  });
}

function daysBetween(a: string, b: string): number {
  return Math.abs(
    (new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60 * 24)
  );
}
