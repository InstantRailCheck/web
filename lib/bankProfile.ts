import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { dedupeToNewestPerReporter, type ReportStatus } from "@/lib/routeConfidence";
import { NON_PAYROLL_DEPOSIT_TYPES, payrollProviderLabel, type DepositType, type PayrollProvider } from "@/lib/eddContext";
import { logError } from "@/lib/logger";

const STALE_DAYS = 180;

// Pooled across every counterparty bank for this rail+direction — a coarser
// unit than routeConfidence's per-pair evidence states, so it intentionally
// doesn't reuse those states. Still applies the same integrity rule (only
// each reporter's newest report per counterparty route counts) and excludes
// unattributed (user_id null) rows, so it can't be inflated by seed data or
// a single repeat reporter the way a raw percentage could.
type RailStats = {
  rail: string;
  attributableCount: number;
  successfulCount: number;
  delayedCount: number;
  unsuccessfulCount: number;
  routeCount: number;
  avgTime: number | null;
  latestObservationDate: string | null;
  isStale: boolean;
  sameDayCount: number | null;
};

// e.g. "3 attributable reports across 2 routes: 2 successful, 1 delayed."
// Shared so the bank detail page and compare page describe the same rail
// the same way rather than drifting apart.
export function describeRailEvidence(rail: RailStats): string {
  const parts: string[] = [];
  if (rail.successfulCount > 0) parts.push(`${rail.successfulCount} successful`);
  if (rail.delayedCount > 0) parts.push(`${rail.delayedCount} delayed`);
  if (rail.unsuccessfulCount > 0) parts.push(`${rail.unsuccessfulCount} unsuccessful`);

  return (
    `${rail.attributableCount} attributable report${rail.attributableCount !== 1 ? "s" : ""} ` +
    `across ${rail.routeCount} route${rail.routeCount !== 1 ? "s" : ""}: ${parts.join(", ")}`
  );
}

export type RailEvidence = {
  source: string;
  sourceUrl: string | null;
  confirmedAt: string | null;
  communityConfirmations: number;
};

export type EddProviderEvidence = {
  provider: PayrollProvider;
  providerLabel: string;
  avgDaysEarly: number;
  reportCount: number;
};

export type EddEvidence = {
  avgDaysEarly: number;
  reportCount: number;
  hasMoreThanFive: boolean;
  // Only providers meeting EDD_PROVIDER_MIN_REPORTERS appear here — a
  // below-threshold provider is simply absent, not included as a
  // zero-count or suppressed placeholder.
  providers: EddProviderEvidence[];
};

// The single definition of "how many distinct reporters before EDD evidence
// is trustworthy enough to show" — every EDD surface (this bank-profile
// evidence, lib/communityRails.ts's ranked leaderboard, and the /banks
// ?edd=true directory filter) must use this one constant, not its own copy,
// or the three could silently drift to different thresholds. Deliberately
// separate from communityRails.ts's own rail-ranking threshold and
// timingLeaderboard.ts's sample-size threshold — those represent different
// product claims and are allowed to diverge from this number.
export const EDD_MIN_REPORTERS = 2;

// Provider-specific claims ("ADP deposits were reported 2 days early by N
// reporters") name a specific company, which is more identifying than the
// bank-wide EDD_MIN_REPORTERS evidence — requires a higher bar before
// becoming public, per the privacy design for this feature.
export const EDD_PROVIDER_MIN_REPORTERS = 3;

// A report of "more than 5 days early" is stored as this sentinel rather
// than an unbounded exact count — matches the edd_reports.days_early check
// constraint (0-6). Exported so the submission form's dropdown stays in sync.
export const EDD_DAYS_SENTINEL = 6;

export type EddReportRow = {
  bank_id: string;
  user_id: string | null;
  days_early: number;
  created_at: string;
  deposit_type: string | null;
  payroll_provider: string | null;
};

// Dedupes to each reporter's newest EDD report per bank (unit: user + bank)
// and drops unattributed rows — the coarser unit backing overall EDD
// evidence (avgDaysEarly/reportCount), independent of what deposit type or
// provider was reported. Shared so every EDD-consuming surface (this
// bank-profile evidence, the ranked leaderboard in lib/communityRails.ts,
// and the /banks ?edd=true directory filter) applies the identical
// integrity rule instead of each re-implementing — and potentially getting
// wrong — its own version.
export function dedupeEddReportsByReporterAndBank(rows: EddReportRow[]): EddReportRow[] {
  const byBank = new Map<string, EddReportRow[]>();
  for (const r of rows) {
    if (!byBank.has(r.bank_id)) byBank.set(r.bank_id, []);
    byBank.get(r.bank_id)!.push(r);
  }
  return Array.from(byBank.values()).flatMap((bankRows) =>
    dedupeToNewestPerReporter(bankRows.map((r) => ({ ...r, userId: r.user_id, testedAt: r.created_at })))
  );
}

// Finer unit than dedupeEddReportsByReporterAndBank: newest report per
// user + bank + deposit_type + payroll_provider. A reporter who's had EDD
// from two different providers at the same bank (e.g. changed jobs) gets
// counted once per distinct context, not collapsed into one — but repeat
// submissions of the *same* context still only count their newest.
function dedupeEddReportsByReporterBankAndContext(rows: EddReportRow[]): EddReportRow[] {
  const byContext = new Map<string, EddReportRow[]>();
  for (const r of rows) {
    const key = `${r.bank_id}|${r.deposit_type}|${r.payroll_provider}`;
    if (!byContext.has(key)) byContext.set(key, []);
    byContext.get(key)!.push(r);
  }
  return Array.from(byContext.values()).flatMap((contextRows) =>
    dedupeToNewestPerReporter(contextRows.map((r) => ({ ...r, userId: r.user_id, testedAt: r.created_at })))
  );
}

// Builds the public, provider-named evidence list for one bank. Excludes:
// unattributed rows (via the dedup step), deposit types that aren't payroll
// (government_benefit/tax_refund/pension — a "government_treasury" answer
// on a tax refund is a sensible thing to have *recorded*, but must never
// surface as a payroll-provider claim), and "unknown"/"other"/null provider
// values, since neither names an actual provider to make a claim about.
// A provider below EDD_PROVIDER_MIN_REPORTERS is omitted entirely — never
// returned as a suppressed/zero-count entry.
export function computeEddProviderEvidence(rows: EddReportRow[]): EddProviderEvidence[] {
  const eligible = rows.filter(
    (r) =>
      r.payroll_provider &&
      r.payroll_provider !== "unknown" &&
      r.payroll_provider !== "other" &&
      r.deposit_type &&
      !NON_PAYROLL_DEPOSIT_TYPES.has(r.deposit_type as DepositType)
  );

  const attributable = dedupeEddReportsByReporterBankAndContext(eligible);

  const byProvider = new Map<string, EddReportRow[]>();
  for (const r of attributable) {
    const key = r.payroll_provider!;
    if (!byProvider.has(key)) byProvider.set(key, []);
    byProvider.get(key)!.push(r);
  }

  const results: EddProviderEvidence[] = [];
  for (const [provider, providerRows] of byProvider) {
    // The context dedup above preserves one row per distinct (deposit_type,
    // provider) a reporter genuinely experienced — but the public claim is
    // "N distinct people", not "N distinct experiences": one person reporting
    // the same provider under paycheck, gig_platform, and unknown would
    // otherwise count 3 times toward the threshold. Collapse to one row per
    // user before counting or averaging.
    const perUser = dedupeToNewestPerReporter(
      providerRows.map((r) => ({ ...r, userId: r.user_id, testedAt: r.created_at }))
    );
    if (perUser.length < EDD_PROVIDER_MIN_REPORTERS) continue;
    results.push({
      provider: provider as PayrollProvider,
      providerLabel: payrollProviderLabel(provider) ?? provider,
      avgDaysEarly:
        Math.round((perUser.reduce((acc, r) => acc + r.days_early, 0) / perUser.length) * 10) / 10,
      reportCount: perUser.length,
    });
  }

  return results.sort((a, b) => b.reportCount - a.reportCount);
}

// e.g. "ADP payroll deposits were reported 2 days early by 6 distinct
// reporters." Describes evidence, not a guarantee — never "ADP deposits
// arrive 2 days early."
export function describeEddProviderEvidence(entry: EddProviderEvidence): string {
  return (
    `${entry.providerLabel} payroll deposits were reported ${entry.avgDaysEarly} ` +
    `day${entry.avgDaysEarly !== 1 ? "s" : ""} early by ${entry.reportCount} distinct reporter${entry.reportCount !== 1 ? "s" : ""}.`
  );
}

export type BankProfile = {
  bank: {
    id: string;
    slug: string;
    name: string;
    website: string | null;
    address: string | null;
    phone: string | null;
    city: string | null;
    state: string | null;
    fdic_cert: number | null;
    ncua_charter_number: number | null;
    source_authority: "fdic" | "ncua" | null;
    total_assets: number | null;
    source_last_synced_at: string | null;
    is_active: boolean;
    inactive_reason: "closed" | "merged" | "unlisted" | null;
    merged_into_bank_id: string | null;
    // Official-source alternate/trade names (NCUA's TradeNames.txt for
    // credit unions, FDIC's trade-name fields for banks) — never
    // user-submitted, so trusted at the same level as website/address/phone.
    aka_names: string[] | null;
    fednow_participant: boolean | null;
    rtp_participant: boolean | null;
    zelle_participant: boolean | null;
  } | null;
  sending: RailStats[];
  receiving: RailStats[];
  railEvidence: Record<"fednow" | "rtp" | "zelle", RailEvidence>;
  eddEvidence: EddEvidence | null;
};

const RAIL_SOURCES: Record<"fednow" | "rtp" | "zelle", { label: string; url: string | null }> = {
  fednow: {
    label: "Federal Reserve's FedNow participant list",
    // The org page the XLSX download link lives on, not the raw file
    // scripts/sync-rail-participants.mjs fetches directly — clicking
    // through shouldn't trigger an unexpected file download.
    url: "https://www.frbservices.org/financial-services/fednow/organizations",
  },
  rtp: {
    label: "The Clearing House's RTP participant list",
    url: "https://www.theclearinghouse.org/payment-systems/rtp/RTP-Participating-Financial-Institutions",
  },
  zelle: {
    // Not linked — Zelle's "source" is a paginated search endpoint
    // (zelle.com/search?page=N), not a page that's meaningful to click into.
    label: "Zelle's partner directory",
    url: null,
  },
};

// route_reports.rail_used stores display names ("FedNow", "RTP", "Zelle"),
// while bank_rail_history/banks columns use lowercase keys — map between them.
const RAIL_DISPLAY_NAMES: Record<"fednow" | "rtp" | "zelle", string> = {
  fednow: "FedNow",
  rtp: "RTP",
  zelle: "Zelle",
};

export async function getBankSlugById(id: string): Promise<string | null> {
  const supabase = createAdminClient();
  const { data } = await supabase.from("banks").select("slug").eq("id", id).maybeSingle();
  return data?.slug ?? null;
}

// Lightweight lookup for callers that just need to resolve a URL slug into
// the minimal {id, slug, name} shape BankSelect's Bank type needs (e.g.
// prefilling a picker from a shared link) — getBankProfileBySlug does 3
// parallel table fetches plus aggregation and is the wrong tool for this.
export async function getBankBySlug(slug: string): Promise<{ id: string; slug: string; name: string } | null> {
  const supabase = createAdminClient();
  const { data } = await supabase.from("banks").select("id, slug, name").eq("slug", slug).maybeSingle();
  return data ?? null;
}

// Wrapped in React's cache() so generateMetadata and the page component
// share one fetch per request instead of each triggering it independently.
export const getBankProfileBySlug = cache(async (slug: string): Promise<BankProfile> => {
  const supabase = createAdminClient();
  const { data: bank } = await supabase
    .from("banks")
    .select("id, slug, name, website, address, phone, city, state, fdic_cert, ncua_charter_number, source_authority, total_assets, source_last_synced_at, is_active, inactive_reason, merged_into_bank_id, aka_names, fednow_participant, rtp_participant, zelle_participant")
    .eq("slug", slug)
    .maybeSingle();

  return buildProfile(bank);
});

// Public API contract (/api/banks/:id) is stable and ID-based — kept
// separate from the slug-based lookup the website itself uses.
export async function getBankProfileById(id: string): Promise<BankProfile> {
  const supabase = createAdminClient();
  const { data: bank } = await supabase
    .from("banks")
    .select("id, slug, name, website, address, phone, city, state, fdic_cert, ncua_charter_number, source_authority, total_assets, source_last_synced_at, is_active, inactive_reason, merged_into_bank_id, aka_names, fednow_participant, rtp_participant, zelle_participant")
    .eq("id", id)
    .maybeSingle();

  return buildProfile(bank);
}

const EMPTY_RAIL_EVIDENCE: BankProfile["railEvidence"] = {
  fednow: { source: RAIL_SOURCES.fednow.label, sourceUrl: RAIL_SOURCES.fednow.url, confirmedAt: null, communityConfirmations: 0 },
  rtp: { source: RAIL_SOURCES.rtp.label, sourceUrl: RAIL_SOURCES.rtp.url, confirmedAt: null, communityConfirmations: 0 },
  zelle: { source: RAIL_SOURCES.zelle.label, sourceUrl: RAIL_SOURCES.zelle.url, confirmedAt: null, communityConfirmations: 0 },
};

async function buildProfile(bank: BankProfile["bank"]): Promise<BankProfile> {
  if (!bank) {
    return { bank: null, sending: [], receiving: [], railEvidence: EMPTY_RAIL_EVIDENCE, eddEvidence: null };
  }

  const supabase = createAdminClient();
  const [
    { data: reports, error: reportsError },
    { data: history, error: historyError },
    { data: eddRows, error: eddError },
  ] = await Promise.all([
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
    supabase
      .from("edd_reports")
      .select("bank_id, user_id, days_early, created_at, deposit_type, payroll_provider")
      .eq("bank_id", bank.id),
  ]);

  // These previously fell straight through to `?? []` on failure with no
  // record anywhere that anything went wrong — indistinguishable from a
  // bank that genuinely has zero reports. "Blank over wrong" is meant for
  // insufficient evidence, not an unlogged query failure.
  for (const [label, err] of [
    ["route_reports", reportsError],
    ["bank_rail_history", historyError],
    ["edd_reports", eddError],
  ] as const) {
    if (err) logError(`Failed to load ${label} for bank profile`, { bankId: bank.id, error: err.message });
  }

  const attributableEddRows = dedupeEddReportsByReporterAndBank(eddRows ?? []);
  const eddEvidence: EddEvidence | null =
    attributableEddRows.length >= EDD_MIN_REPORTERS
      ? {
          avgDaysEarly:
            Math.round(
              (attributableEddRows.reduce((acc, r) => acc + r.days_early, 0) / attributableEddRows.length) * 10
            ) / 10,
          reportCount: attributableEddRows.length,
          // The average would understate reality if any report used the
          // "more than 5" sentinel — flag it so the display can say "5.5+"
          // instead of implying an exact figure.
          hasMoreThanFive: attributableEddRows.some((r) => r.days_early === EDD_DAYS_SENTINEL),
          providers: computeEddProviderEvidence(eddRows ?? []),
        }
      : null;

  const sendingRows = (reports ?? [])
    .filter((r) => r.from_bank_id === bank.id)
    .map((r) => ({ ...r, counterpartyId: r.to_bank_id as string }));
  const receivingRows = (reports ?? [])
    .filter((r) => r.to_bank_id === bank.id)
    .map((r) => ({ ...r, counterpartyId: r.from_bank_id as string }));
  const sending = summarizeByRail(sendingRows);
  const receiving = summarizeByRail(receivingRows);

  const railEvidence = { ...EMPTY_RAIL_EVIDENCE };
  for (const rail of ["fednow", "rtp", "zelle"] as const) {
    // history is ordered newest-first, so the first match is the most recent
    // confirmation — could be the original backfill or a later re-check.
    const confirmedAt = history?.find((h) => h.rail === rail)?.changed_at ?? null;
    const displayName = RAIL_DISPLAY_NAMES[rail];
    const communityConfirmations =
      (sending.find((s) => s.rail === displayName)?.attributableCount ?? 0) +
      (receiving.find((r) => r.rail === displayName)?.attributableCount ?? 0);
    railEvidence[rail] = {
      source: RAIL_SOURCES[rail].label,
      sourceUrl: RAIL_SOURCES[rail].url,
      confirmedAt,
      communityConfirmations,
    };
  }

  return { bank, sending, receiving, railEvidence, eddEvidence };
}

type RouteReportRow = {
  rail_used: string | null;
  status: string;
  settlement_time_minutes: number | null;
  tested_at: string | null;
  same_day: boolean | null;
  user_id: string | null;
  counterpartyId: string;
};

function summarizeByRail(rows: RouteReportRow[]): RailStats[] {
  const rails = Array.from(new Set(rows.map((r) => r.rail_used || "unknown")));

  return rails
    .map((rail) => {
      const railRows = rows.filter((r) => (r.rail_used || "unknown") === rail);

      // Apply the newest-report-per-reporter rule per counterparty route
      // (same integrity rule as routeConfidence.ts's pairwise evidence),
      // then pool the results across every counterparty for this rail.
      const byCounterparty = new Map<string, RouteReportRow[]>();
      for (const r of railRows) {
        if (!byCounterparty.has(r.counterpartyId)) byCounterparty.set(r.counterpartyId, []);
        byCounterparty.get(r.counterpartyId)!.push(r);
      }

      const attributableRows = Array.from(byCounterparty.values()).flatMap((counterpartyRows) =>
        dedupeToNewestPerReporter(
          counterpartyRows
            .filter((r): r is RouteReportRow & { tested_at: string } => !!r.tested_at)
            .map((r) => ({ ...r, userId: r.user_id, status: r.status as ReportStatus, testedAt: r.tested_at }))
        )
      );

      const routeCount = Array.from(byCounterparty.entries()).filter(([, counterpartyRows]) =>
        counterpartyRows.some((r) => r.user_id !== null)
      ).length;

      const timingRows = attributableRows.filter(
        (r): r is typeof r & { settlement_time_minutes: number } => r.settlement_time_minutes != null
      );
      const avgTime =
        timingRows.length > 0
          ? Math.round(
              timingRows.reduce((acc, r) => acc + r.settlement_time_minutes, 0) / timingRows.length
            )
          : null;

      const dates = attributableRows.map((r) => r.testedAt).sort().reverse();
      const latestObservationDate = dates[0] ?? null;
      const isStale = latestObservationDate
        ? daysBetween(latestObservationDate, new Date().toISOString().split("T")[0]) > STALE_DAYS
        : false;

      const sameDayCount = rail === "ACH" ? attributableRows.filter((r) => r.same_day === true).length : null;

      return {
        rail,
        attributableCount: attributableRows.length,
        successfulCount: attributableRows.filter((r) => r.status === "success").length,
        delayedCount: attributableRows.filter((r) => r.status === "delayed").length,
        unsuccessfulCount: attributableRows.filter((r) => r.status === "failed").length,
        routeCount,
        avgTime,
        latestObservationDate,
        isStale,
        sameDayCount,
      };
    })
    // A rail backed only by unattributed/seed rows has nothing to show —
    // "blank over wrong" applies here too, not just to the pairwise states.
    .filter((r) => r.attributableCount > 0);
}

function daysBetween(a: string, b: string): number {
  return Math.abs(
    (new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60 * 24)
  );
}
