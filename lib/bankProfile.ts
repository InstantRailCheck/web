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

export type RailEvidence = {
  source: string;
  confirmedAt: string | null;
  communityConfirmations: number;
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
  railEvidence: Record<"fednow" | "rtp" | "zelle", RailEvidence>;
};

const RAIL_SOURCES: Record<"fednow" | "rtp" | "zelle", string> = {
  fednow: "Federal Reserve's FedNow participant list",
  rtp: "The Clearing House's RTP participant list",
  zelle: "Zelle's partner directory",
};

// route_reports.rail_used stores display names ("FedNow", "RTP", "Zelle"),
// while bank_rail_history/banks columns use lowercase keys — map between them.
const RAIL_DISPLAY_NAMES: Record<"fednow" | "rtp" | "zelle", string> = {
  fednow: "FedNow",
  rtp: "RTP",
  zelle: "Zelle",
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

const EMPTY_RAIL_EVIDENCE: BankProfile["railEvidence"] = {
  fednow: { source: RAIL_SOURCES.fednow, confirmedAt: null, communityConfirmations: 0 },
  rtp: { source: RAIL_SOURCES.rtp, confirmedAt: null, communityConfirmations: 0 },
  zelle: { source: RAIL_SOURCES.zelle, confirmedAt: null, communityConfirmations: 0 },
};

async function buildProfile(bank: BankProfile["bank"]): Promise<BankProfile> {
  if (!bank) {
    return { bank: null, sending: [], receiving: [], railEvidence: EMPTY_RAIL_EVIDENCE };
  }

  const supabase = await createClient();
  const [{ data: reports }, { data: history }] = await Promise.all([
    supabase
      .from("route_reports")
      .select("*")
      .or(`from_bank_id.eq.${bank.id},to_bank_id.eq.${bank.id}`),
    supabase
      .from("bank_rail_history")
      .select("rail, changed_at")
      .eq("bank_id", bank.id)
      .eq("new_value", true)
      .order("changed_at", { ascending: false }),
  ]);

  const sendingRows = (reports ?? []).filter((r) => r.from_bank_id === bank.id);
  const receivingRows = (reports ?? []).filter((r) => r.to_bank_id === bank.id);
  const sending = summarizeByRail(sendingRows);
  const receiving = summarizeByRail(receivingRows);

  const railEvidence = { ...EMPTY_RAIL_EVIDENCE };
  for (const rail of ["fednow", "rtp", "zelle"] as const) {
    // history is ordered newest-first, so the first match is the most recent
    // confirmation — could be the original backfill or a later re-check.
    const confirmedAt = history?.find((h) => h.rail === rail)?.changed_at ?? null;
    const displayName = RAIL_DISPLAY_NAMES[rail];
    const communityConfirmations =
      (sending.find((s) => s.rail === displayName)?.count ?? 0) +
      (receiving.find((r) => r.rail === displayName)?.count ?? 0);
    railEvidence[rail] = { source: RAIL_SOURCES[rail], confirmedAt, communityConfirmations };
  }

  return { bank, sending, receiving, railEvidence };
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
