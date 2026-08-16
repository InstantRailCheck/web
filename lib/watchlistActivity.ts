import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  computeRouteEvidence,
  FRESHNESS_WINDOW_DAYS,
  EVIDENCE_LABELS,
  type EvidenceState,
  type RouteEvidence,
  type RouteReportInput,
} from "@/lib/routeConfidence";
import type { WatchlistBankEntry, WatchlistRouteEntry } from "@/lib/actions/getWatchlist";

export type WatchlistActivityItem = {
  key: string; // `${fromBankId}::${toBankId}::${rail}`
  fromBankId: string;
  fromBankSlug: string;
  fromBankName: string;
  toBankId: string;
  toBankSlug: string;
  toBankName: string;
  rail: string;
  changeLabel: string;
  latestReportAt: string;
};

type ReportRow = {
  from_bank_id: string;
  to_bank_id: string;
  rail_used: string | null;
  status: string;
  tested_at: string | null;
  user_id: string | null;
  created_at: string;
};

type Watchlist = { banks: WatchlistBankEntry[]; routes: WatchlistRouteEntry[] };

export type WatchlistFollowIndex = {
  bankFollowIds: Set<string>;
  routeFollowKeys: Set<string>;
  allBankIds: Set<string>;
};

// A bank-follow matches a report touching that bank on either side; a
// route-follow (directional) matches only the exact from->to pair — never
// its reverse. allBankIds is the union used only to narrow the initial DB
// query to a superset; matchesWatchlist below is what actually decides
// membership.
export function buildWatchlistFollowIndex(watchlist: Watchlist): WatchlistFollowIndex {
  const bankFollowIds = new Set(watchlist.banks.map((b) => b.bankId));
  const routeFollowKeys = new Set(watchlist.routes.map((r) => `${r.fromBankId}::${r.toBankId}`));
  const allBankIds = new Set(bankFollowIds);
  for (const r of watchlist.routes) {
    allBankIds.add(r.fromBankId);
    allBankIds.add(r.toBankId);
  }
  return { bankFollowIds, routeFollowKeys, allBankIds };
}

export function matchesWatchlist(
  row: { from_bank_id: string; to_bank_id: string },
  index: WatchlistFollowIndex
): boolean {
  return (
    index.bankFollowIds.has(row.from_bank_id) ||
    index.bankFollowIds.has(row.to_bank_id) ||
    index.routeFollowKeys.has(`${row.from_bank_id}::${row.to_bank_id}`)
  );
}

// No prior watchlist_activity_last_seen row means "never viewed the feed" —
// treated as FRESHNESS_WINDOW_DAYS ago (not epoch) so a long-dormant or
// brand-new account doesn't get flooded with a full-history scan; nothing
// older than that window could move a route's evidence state anyway.
export function resolveActivityLastSeenAt(lastSeenAt: string | null | undefined): string {
  return lastSeenAt ?? new Date(Date.now() - FRESHNESS_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

// Bounds a (possibly very old) last-seen timestamp to at most
// FRESHNESS_WINDOW_DAYS ago, so a long-dormant account's query never scans
// further back than evidence itself can be fresh — used identically by the
// full feed and the header count so neither scans a wider window than the
// other and they can't disagree about what's "new."
export function activityQueryCutoff(lastSeenAt: string): string {
  const cutoffMs = Math.max(
    new Date(lastSeenAt).getTime(),
    Date.now() - FRESHNESS_WINDOW_DAYS * 24 * 60 * 60 * 1000
  );
  return new Date(cutoffMs).toISOString();
}

function groupKey(row: { from_bank_id: string; to_bank_id: string; rail_used: string | null }): string {
  return `${row.from_bank_id}::${row.to_bank_id}::${row.rail_used ?? "Unknown"}`;
}

function toReportInput(r: ReportRow): RouteReportInput | null {
  if (!r.tested_at) return null;
  if (r.status !== "success" && r.status !== "failed" && r.status !== "delayed") return null;
  return { userId: r.user_id, status: r.status, testedAt: r.tested_at };
}

function isReportInput(x: RouteReportInput | null): x is RouteReportInput {
  return x !== null;
}

function buildChangeLabel(before: RouteEvidence | null, after: RouteEvidence): string {
  if (!before) {
    const confirmed: EvidenceState[] = ["observed_working", "consistently_reported"];
    return confirmed.includes(after.state) ? "Newly confirmed working" : `New evidence: ${EVIDENCE_LABELS[after.state]}`;
  }
  if (before.state !== after.state) {
    return `Evidence updated: ${EVIDENCE_LABELS[before.state]} → ${EVIDENCE_LABELS[after.state]}`;
  }
  return `New report added (still ${EVIDENCE_LABELS[after.state]})`;
}

// Reused by both the full feed (lib/actions/getWatchlistActivity.ts) and the
// header's cheap unread count (lib/actions/getWatchlistActivityCount.ts) so
// they can never disagree about what counts as "new since last seen."
export async function computeWatchlistActivity(
  userId: string,
  watchlist: Watchlist,
  lastSeenAt: string
): Promise<WatchlistActivityItem[]> {
  const index = buildWatchlistFollowIndex(watchlist);
  if (index.allBankIds.size === 0) return [];

  const admin = createAdminClient();
  const ids = [...index.allBankIds];

  // Own reports are excluded — a user submitting a report about their own
  // followed bank/route shouldn't see it come back to them as "activity."
  const { data: candidates, error } = await admin
    .from("route_reports")
    .select("from_bank_id, to_bank_id, rail_used, status, tested_at, user_id, created_at")
    .or(`from_bank_id.in.(${ids.join(",")}),to_bank_id.in.(${ids.join(",")})`)
    .gte("created_at", activityQueryCutoff(lastSeenAt))
    .neq("user_id", userId)
    .not("user_id", "is", null);

  if (error || !candidates) return [];

  const qualifying = (candidates as ReportRow[]).filter((row) => matchesWatchlist(row, index));
  if (qualifying.length === 0) return [];

  const affectedGroups = new Map<string, ReportRow[]>();
  for (const row of qualifying) {
    const key = groupKey(row);
    if (!affectedGroups.has(key)) affectedGroups.set(key, []);
    affectedGroups.get(key)!.push(row);
  }

  // Full history per affected (from,to,rail) group, unbounded by date —
  // same "fetch everything, let computeRouteEvidence apply its own
  // freshness window" approach as lib/routingEngine.ts's getRouteIntelligence,
  // so the "before" state can correctly reflect even a stale prior report.
  const affectedFromBankIds = [...new Set(qualifying.map((r) => r.from_bank_id))];
  const { data: historyRows } = await admin
    .from("route_reports")
    .select("from_bank_id, to_bank_id, rail_used, status, tested_at, user_id, created_at")
    .in("from_bank_id", affectedFromBankIds);

  const historyByGroup = new Map<string, ReportRow[]>();
  for (const row of (historyRows as ReportRow[] | null) ?? []) {
    const key = groupKey(row);
    if (!affectedGroups.has(key)) continue;
    if (!historyByGroup.has(key)) historyByGroup.set(key, []);
    historyByGroup.get(key)!.push(row);
  }

  const referencedBankIds = new Set<string>();
  for (const rows of affectedGroups.values()) {
    for (const r of rows) {
      referencedBankIds.add(r.from_bank_id);
      referencedBankIds.add(r.to_bank_id);
    }
  }
  const { data: bankRows } = await admin.from("banks").select("id, slug, name").in("id", [...referencedBankIds]);
  const bankById = new Map((bankRows ?? []).map((b) => [b.id as string, b as { id: string; slug: string; name: string }]));

  const lastSeenMs = new Date(lastSeenAt).getTime();
  const items: WatchlistActivityItem[] = [];

  for (const [key, newRows] of affectedGroups) {
    const history = historyByGroup.get(key) ?? [];
    const before = history.filter((r) => new Date(r.created_at).getTime() < lastSeenMs);

    const stateBefore = computeRouteEvidence(before.map(toReportInput).filter(isReportInput));
    const stateAfter = computeRouteEvidence(history.map(toReportInput).filter(isReportInput));
    // Every qualifying row is attributable (user_id excluded via .not("user_id","is",null)
    // above), so stateAfter can't actually be null here — guarded anyway
    // since computeRouteEvidence's return type allows it.
    if (!stateAfter) continue;

    const newest = newRows.reduce((a, b) => (b.created_at > a.created_at ? b : a));
    const fromBank = bankById.get(newest.from_bank_id);
    const toBank = bankById.get(newest.to_bank_id);
    if (!fromBank || !toBank) continue;

    items.push({
      key,
      fromBankId: fromBank.id,
      fromBankSlug: fromBank.slug,
      fromBankName: fromBank.name,
      toBankId: toBank.id,
      toBankSlug: toBank.slug,
      toBankName: toBank.name,
      rail: newest.rail_used ?? "Unknown",
      changeLabel: buildChangeLabel(stateBefore, stateAfter),
      latestReportAt: newest.created_at,
    });
  }

  return items.sort((a, b) => new Date(b.latestReportAt).getTime() - new Date(a.latestReportAt).getTime()).slice(0, 50);
}
