import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { FRESHNESS_WINDOW_DAYS, dedupeToNewestPerReporter } from "@/lib/routeConfidence";
import {
  evaluateVelocity,
  evaluateDuplicateRouteReport,
  evaluateDuplicateEddReport,
  evaluateConsensusConflict,
  evaluateSettlementTimeOutlier,
  evaluateModerationHistory,
  evaluateOfficialSourceMismatch,
  sortSignals,
  scoreOf,
  type Signal,
  type Severity,
  type SignalType,
} from "@/lib/riskSignals";

export const TRIAGE_PAGE_SIZE = 20;
export const TRIAGE_WINDOW_DAYS = 30;
const SEVERITY_RANK: Record<Severity, number> = { info: 0, warning: 1, high: 2 };

export type TriageTableFilter = "all" | "route_reports" | "edd_reports";

export type ComparisonReport = {
  id: string;
  status: string;
  testedAt: string | null;
  settlementTimeMinutes: number | null;
};

export type RouteReportTriageRow = {
  table: "route_reports";
  id: string;
  createdAt: string;
  userId: string | null;
  fromBankName: string;
  toBankName: string;
  railUsed: string | null;
  direction: string | null;
  status: string;
  testedAt: string | null;
  settlementTimeMinutes: number | null;
  signals: Signal[];
  score: number;
  comparison: ComparisonReport[];
};

export type EddReportTriageRow = {
  table: "edd_reports";
  id: string;
  createdAt: string;
  userId: string | null;
  bankName: string;
  daysEarly: number;
  signals: Signal[];
  score: number;
  comparison: ComparisonReport[];
};

export type TriageRow = RouteReportTriageRow | EddReportTriageRow;

export type TriageFilters = {
  page: number;
  table: TriageTableFilter;
  minSeverity: Severity;
  signalTypes: SignalType[] | null;
  bankFilter: string;
  accountFilter: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  showReviewed: boolean;
};

type RouteReportRaw = {
  id: string;
  from_bank_id: string | null;
  to_bank_id: string | null;
  from_bank_name: string | null;
  to_bank_name: string | null;
  rail_used: string | null;
  direction: string | null;
  status: string;
  tested_at: string | null;
  settlement_time_minutes: number | null;
  user_id: string | null;
  created_at: string;
};

type EddReportRaw = {
  id: string;
  bank_id: string;
  days_early: number;
  user_id: string | null;
  created_at: string;
};

type ConsensusPoolRow = Omit<RouteReportRaw, "from_bank_name" | "to_bank_name">;

function daysAgoIso(days: number, now: Date): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

// This queries the tables directly rather than hooking submission call
// sites — route_reports and edd_reports both still have a direct
// authenticated-insert RLS policy, so a row can land there via the Server
// Action or a direct client insert. Reading the table itself covers both
// paths identically; there is no separate "did this come through the app"
// case to handle.
export async function fetchTriageQueue(filters: TriageFilters, now: Date = new Date()): Promise<{ rows: TriageRow[]; total: number }> {
  const admin = createAdminClient();
  const windowStart = filters.dateFrom ?? daysAgoIso(TRIAGE_WINDOW_DAYS, now);
  const windowEnd = filters.dateTo ?? now.toISOString();
  // Padded one day earlier than the ACTUAL display window (not always
  // "now") so a candidate near the window's edge still has its full
  // trailing 24h of same-user activity available for the velocity signal —
  // for a custom historical date range this must pad the selected range,
  // not the last 31 days, or velocity context for old candidates would be
  // fetched from the wrong period entirely.
  const activityWindowStart = new Date(new Date(windowStart).getTime() - 24 * 60 * 60 * 1000).toISOString();

  let routeReports: RouteReportRaw[] = [];
  let eddReports: EddReportRaw[] = [];

  if (filters.table !== "edd_reports") {
    let query = admin
      .from("route_reports")
      .select(
        "id, from_bank_id, to_bank_id, from_bank_name, to_bank_name, rail_used, direction, status, tested_at, settlement_time_minutes, user_id, created_at"
      )
      .gte("created_at", windowStart)
      .lte("created_at", windowEnd)
      .not("user_id", "is", null);
    if (filters.accountFilter) query = query.eq("user_id", filters.accountFilter);
    const { data, error } = await query;
    if (error) throw error;
    routeReports = data ?? [];
  }

  if (filters.table !== "route_reports") {
    let query = admin
      .from("edd_reports")
      .select("id, bank_id, days_early, user_id, created_at")
      .gte("created_at", windowStart)
      .lte("created_at", windowEnd)
      .not("user_id", "is", null);
    if (filters.accountFilter) query = query.eq("user_id", filters.accountFilter);
    const { data, error } = await query;
    if (error) throw error;
    eddReports = data ?? [];
  }

  if (routeReports.length === 0 && eddReports.length === 0) return { rows: [], total: 0 };

  if (filters.bankFilter.trim()) {
    const { data: matchingBanks, error } = await admin.from("banks").select("id").ilike("name", `%${filters.bankFilter.trim()}%`);
    if (error) throw error;
    const bankIds = new Set((matchingBanks ?? []).map((b) => b.id as string));
    routeReports = routeReports.filter((r) => (r.from_bank_id && bankIds.has(r.from_bank_id)) || (r.to_bank_id && bankIds.has(r.to_bank_id)));
    eddReports = eddReports.filter((r) => bankIds.has(r.bank_id));
  }

  const userIds = [...new Set([...routeReports.map((r) => r.user_id), ...eddReports.map((r) => r.user_id)].filter((id): id is string => id !== null))];

  // Same-user activity across both tables, padded window — powers velocity.
  const [routeActivity, eddActivity] = await Promise.all([
    userIds.length
      ? admin.from("route_reports").select("id, user_id, created_at").in("user_id", userIds).gte("created_at", activityWindowStart).lte("created_at", windowEnd)
      : Promise.resolve({ data: [] as { id: string; user_id: string | null; created_at: string }[], error: null }),
    userIds.length
      ? admin.from("edd_reports").select("id, user_id, created_at").in("user_id", userIds).gte("created_at", activityWindowStart).lte("created_at", windowEnd)
      : Promise.resolve({ data: [] as { id: string; user_id: string | null; created_at: string }[], error: null }),
  ]);
  if (routeActivity.error) throw routeActivity.error;
  if (eddActivity.error) throw eddActivity.error;

  // All-time row counts per user (not window-bounded) — distinguishes a
  // brand-new reporter's first burst from an established account's unusual
  // day. Small N (distinct users in a triage window) at current volume; see
  // PROJECT.md for the scaling note if this ever needs to become one
  // grouped query instead of per-user counts.
  const totalCountsByUser = new Map<string, number>();
  await Promise.all(
    userIds.map(async (uid) => {
      const [routeCount, eddCount] = await Promise.all([
        admin.from("route_reports").select("id", { count: "exact", head: true }).eq("user_id", uid),
        admin.from("edd_reports").select("id", { count: "exact", head: true }).eq("user_id", uid),
      ]);
      // A failed count must not silently read as zero — that would make an
      // established account look brand-new and could wrongly trigger the
      // high-severity new-reporter-high-volume signal against them.
      if (routeCount.error) throw routeCount.error;
      if (eddCount.error) throw eddCount.error;
      totalCountsByUser.set(uid, (routeCount.count ?? 0) + (eddCount.count ?? 0));
    })
  );

  // Moderation history per user.
  const moderationHistoryByUser = new Map<string, { priorRemovedSubmissions: number; priorEnforcementActions: number; currentStatus: string }>();
  if (userIds.length) {
    const [deletes, enforcement, statuses] = await Promise.all([
      admin.from("moderation_actions").select("subject_user_id").eq("action_type", "delete").in("subject_user_id", userIds),
      admin.from("moderation_actions").select("subject_user_id").in("action_type", ["restrict", "suspend", "ban"]).in("subject_user_id", userIds),
      admin.from("user_moderation_status").select("user_id, status").in("user_id", userIds),
    ]);
    if (deletes.error) throw deletes.error;
    if (enforcement.error) throw enforcement.error;
    if (statuses.error) throw statuses.error;

    const statusByUser = new Map((statuses.data ?? []).map((s) => [s.user_id as string, s.status as string]));
    for (const uid of userIds) {
      const priorRemovedSubmissions = (deletes.data ?? []).filter((d) => d.subject_user_id === uid).length;
      const priorEnforcementActions = (enforcement.data ?? []).filter((d) => d.subject_user_id === uid).length;
      moderationHistoryByUser.set(uid, {
        priorRemovedSubmissions,
        priorEnforcementActions,
        currentStatus: statusByUser.get(uid) ?? "active",
      });
    }
  }

  // Broad 180-day attributable route_reports fetch for consensus/outlier
  // comparison, grouped in memory by (from,to,direction,rail) — simplest
  // correct approach at current volume; see riskTriage's own doc comment
  // if this table ever grows enough to need narrower per-route queries.
  let consensusPool: ConsensusPoolRow[] = [];
  if (routeReports.length > 0) {
    const { data, error } = await admin
      .from("route_reports")
      .select("id, from_bank_id, to_bank_id, rail_used, direction, status, tested_at, settlement_time_minutes, user_id, created_at")
      .not("user_id", "is", null)
      .gte("created_at", daysAgoIso(FRESHNESS_WINDOW_DAYS, now));
    if (error) throw error;
    consensusPool = data ?? [];
  }
  const routeKey = (r: { from_bank_id: string | null; to_bank_id: string | null; direction: string | null; rail_used: string | null }) =>
    `${r.from_bank_id}|${r.to_bank_id}|${r.direction}|${r.rail_used}`;
  const poolByRoute = new Map<string, ConsensusPoolRow[]>();
  for (const r of consensusPool) {
    const key = routeKey(r);
    if (!poolByRoute.has(key)) poolByRoute.set(key, []);
    poolByRoute.get(key)!.push(r);
  }

  // Bank participation flags for FedNow/RTP candidates.
  const bankIdsForParticipation = new Set<string>();
  for (const r of routeReports) {
    if (r.rail_used === "FedNow" || r.rail_used === "RTP") {
      if (r.from_bank_id) bankIdsForParticipation.add(r.from_bank_id);
      if (r.to_bank_id) bankIdsForParticipation.add(r.to_bank_id);
    }
  }
  const bankParticipationById = new Map<string, { name: string; fednow: boolean | null; rtp: boolean | null }>();
  if (bankIdsForParticipation.size > 0) {
    const { data, error } = await admin
      .from("banks")
      .select("id, name, fednow_participant, rtp_participant")
      .in("id", [...bankIdsForParticipation]);
    if (error) throw error;
    for (const b of data ?? []) {
      bankParticipationById.set(b.id, { name: b.name, fednow: b.fednow_participant, rtp: b.rtp_participant });
    }
  }

  // EDD bank names.
  const eddBankIds = [...new Set(eddReports.map((r) => r.bank_id))];
  const eddBankNameById = new Map<string, string>();
  if (eddBankIds.length > 0) {
    const { data, error } = await admin.from("banks").select("id, name").in("id", eddBankIds);
    if (error) throw error;
    for (const b of data ?? []) eddBankNameById.set(b.id, b.name);
  }

  const rows: TriageRow[] = [];

  for (const candidate of routeReports) {
    if (!candidate.user_id) continue;
    const signals: Signal[] = [];

    const sameUserOtherTimestamps = routeActivity.data!.filter((r) => r.user_id === candidate.user_id && r.id !== candidate.id).map((r) => r.created_at);
    const totalForUser = totalCountsByUser.get(candidate.user_id) ?? 0;
    const velocitySignal = evaluateVelocity(
      {
        tableLabel: "route report",
        candidateCreatedAt: candidate.created_at,
        sameUserOtherTimestamps,
        userTotalRowsExcludingCandidate: Math.max(totalForUser - 1, 0),
      }
    );
    if (velocitySignal) signals.push(velocitySignal);

    const sameUserOtherReports = routeReports
      .filter((r) => r.user_id === candidate.user_id && r.id !== candidate.id)
      .map((r) => ({
        id: r.id,
        fromBankId: r.from_bank_id,
        toBankId: r.to_bank_id,
        direction: r.direction,
        railUsed: r.rail_used,
        status: r.status,
        testedAt: r.tested_at ?? r.created_at,
        createdAt: r.created_at,
      }));
    const duplicateSignal = evaluateDuplicateRouteReport(
      { id: candidate.id, fromBankId: candidate.from_bank_id, toBankId: candidate.to_bank_id, direction: candidate.direction, railUsed: candidate.rail_used, status: candidate.status, testedAt: candidate.tested_at ?? candidate.created_at, createdAt: candidate.created_at },
      sameUserOtherReports,
      now
    );
    if (duplicateSignal) signals.push(duplicateSignal);

    const routePool = (poolByRoute.get(routeKey(candidate)) ?? []).filter((r) => r.id !== candidate.id);
    const consensusSignal = evaluateConsensusConflict(
      { userId: candidate.user_id, status: candidate.status as "success" | "failed" | "delayed", testedAt: candidate.tested_at ?? candidate.created_at },
      routePool.map((r) => ({ userId: r.user_id!, status: r.status as "success" | "failed" | "delayed", testedAt: r.tested_at ?? r.created_at })),
      now
    );
    if (consensusSignal) signals.push(consensusSignal);

    let comparison: ComparisonReport[] = [];
    if (candidate.status === "success" && candidate.settlement_time_minutes !== null) {
      // Deduped to newest-per-reporter first — same integrity rule the
      // consensus signal gets for free through computeRouteEvidence's own
      // internal dedup. Without this, one account repeating the same route
      // several times would count as several independent comparison
      // points and could single-handedly drag the median/MAD baseline.
      const dedupedPool = dedupeToNewestPerReporter(
        routePool.map((r) => ({ userId: r.user_id, testedAt: r.tested_at ?? r.created_at, status: r.status, settlementTimeMinutes: r.settlement_time_minutes }))
      );
      const otherSuccessMinutes = dedupedPool
        .filter((r) => r.status === "success" && r.settlementTimeMinutes !== null)
        .map((r) => r.settlementTimeMinutes!);
      const outlierSignal = evaluateSettlementTimeOutlier(candidate.settlement_time_minutes, otherSuccessMinutes);
      if (outlierSignal) signals.push(outlierSignal);
    }
    if (consensusSignal || signals.some((s) => s.signal === "settlement_time_outlier")) {
      comparison = routePool
        .slice()
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, 4)
        .map((r) => ({ id: r.id, status: r.status, testedAt: r.tested_at, settlementTimeMinutes: r.settlement_time_minutes }));
    }

    const history = moderationHistoryByUser.get(candidate.user_id);
    if (history) {
      const historySignal = evaluateModerationHistory({
        priorRemovedSubmissions: history.priorRemovedSubmissions,
        priorEnforcementActions: history.priorEnforcementActions,
        currentStatus: history.currentStatus as "active" | "restricted" | "temporarily_banned" | "permanently_banned",
      });
      if (historySignal) signals.push(historySignal);
    }

    if (candidate.rail_used === "FedNow" || candidate.rail_used === "RTP") {
      const fromP = candidate.from_bank_id ? bankParticipationById.get(candidate.from_bank_id) : undefined;
      const toP = candidate.to_bank_id ? bankParticipationById.get(candidate.to_bank_id) : undefined;
      if (fromP && toP) {
        const rail = candidate.rail_used as "FedNow" | "RTP";
        const mismatchSignal = evaluateOfficialSourceMismatch(rail, {
          fromBankName: fromP.name,
          toBankName: toP.name,
          fromBankParticipant: rail === "FedNow" ? fromP.fednow : fromP.rtp,
          toBankParticipant: rail === "FedNow" ? toP.fednow : toP.rtp,
        });
        if (mismatchSignal) signals.push(mismatchSignal);
      }
    }

    if (signals.length === 0) continue;

    rows.push({
      table: "route_reports",
      id: candidate.id,
      createdAt: candidate.created_at,
      userId: candidate.user_id,
      fromBankName: candidate.from_bank_name ?? "Unknown bank",
      toBankName: candidate.to_bank_name ?? "Unknown bank",
      railUsed: candidate.rail_used,
      direction: candidate.direction,
      status: candidate.status,
      testedAt: candidate.tested_at,
      settlementTimeMinutes: candidate.settlement_time_minutes,
      signals: sortSignals(signals),
      score: scoreOf(signals),
      comparison,
    });
  }

  for (const candidate of eddReports) {
    if (!candidate.user_id) continue;
    const signals: Signal[] = [];

    const sameUserOtherTimestamps = eddActivity.data!.filter((r) => r.user_id === candidate.user_id && r.id !== candidate.id).map((r) => r.created_at);
    const totalForUser = totalCountsByUser.get(candidate.user_id) ?? 0;
    const velocitySignal = evaluateVelocity(
      {
        tableLabel: "EDD report",
        candidateCreatedAt: candidate.created_at,
        sameUserOtherTimestamps,
        userTotalRowsExcludingCandidate: Math.max(totalForUser - 1, 0),
      }
    );
    if (velocitySignal) signals.push(velocitySignal);

    const sameUserOtherReports = eddReports
      .filter((r) => r.user_id === candidate.user_id && r.id !== candidate.id)
      .map((r) => ({ id: r.id, bankId: r.bank_id, daysEarly: r.days_early, createdAt: r.created_at }));
    const duplicateSignal = evaluateDuplicateEddReport(
      { id: candidate.id, bankId: candidate.bank_id, daysEarly: candidate.days_early, createdAt: candidate.created_at },
      sameUserOtherReports,
      now
    );
    if (duplicateSignal) signals.push(duplicateSignal);

    const history = moderationHistoryByUser.get(candidate.user_id);
    if (history) {
      const historySignal = evaluateModerationHistory({
        priorRemovedSubmissions: history.priorRemovedSubmissions,
        priorEnforcementActions: history.priorEnforcementActions,
        currentStatus: history.currentStatus as "active" | "restricted" | "temporarily_banned" | "permanently_banned",
      });
      if (historySignal) signals.push(historySignal);
    }

    if (signals.length === 0) continue;

    rows.push({
      table: "edd_reports",
      id: candidate.id,
      createdAt: candidate.created_at,
      userId: candidate.user_id,
      bankName: eddBankNameById.get(candidate.bank_id) ?? "Unknown bank",
      daysEarly: candidate.days_early,
      signals: sortSignals(signals),
      score: scoreOf(signals),
      comparison: [],
    });
  }

  let filtered = rows.filter((r) => r.score > 0 && r.signals.some((s) => SEVERITY_RANK[s.severity] >= SEVERITY_RANK[filters.minSeverity]));
  if (filters.signalTypes && filters.signalTypes.length > 0) {
    const wanted = new Set(filters.signalTypes);
    filtered = filtered.filter((r) => r.signals.some((s) => wanted.has(s.signal)));
  }

  if (!filters.showReviewed && filtered.length > 0) {
    const { data: reviewed, error } = await admin
      .from("moderation_actions")
      .select("target_table, target_id, snapshot")
      .eq("action_type", "review_flag")
      .in(
        "target_id",
        filtered.map((r) => r.id)
      );
    if (error) throw error;
    // Score alone isn't enough: two different signal sets can add up to
    // the same total (a reviewed warning-level duplicate replaced by an
    // unrelated warning-level moderation-history flag both score 2), and
    // the admin never actually saw that new evidence. A row stays hidden
    // only if some past review's own signal-TYPE set already covered every
    // signal type firing right now, at a score at least as high — i.e. the
    // admin genuinely already saw everything currently being flagged. A
    // brand-new signal type, or the same types at a higher score (e.g. a
    // duplicate that matched one report before and three now), resurfaces
    // it. Multiple past reviews for the same target each get checked;
    // covered by any one of them is enough to stay hidden.
    const reviewsByKey = new Map<string, { types: Set<SignalType>; score: number }[]>();
    for (const r of reviewed ?? []) {
      const key = `${r.target_table}:${r.target_id}`;
      const snapshot = r.snapshot as { score?: unknown; signals?: unknown } | null;
      const snapshotScore = Number(snapshot?.score);
      const reviewedScore = Number.isFinite(snapshotScore) ? snapshotScore : 0;
      const reviewedSignals = Array.isArray(snapshot?.signals) ? (snapshot.signals as { signal?: unknown }[]) : [];
      const types = new Set(reviewedSignals.map((s) => s.signal).filter((s): s is SignalType => typeof s === "string"));
      const list = reviewsByKey.get(key) ?? [];
      list.push({ types, score: reviewedScore });
      reviewsByKey.set(key, list);
    }
    filtered = filtered.filter((r) => {
      const reviews = reviewsByKey.get(`${r.table}:${r.id}`);
      if (!reviews) return true;
      const currentTypes = new Set(r.signals.map((s) => s.signal));
      const coveredByAPastReview = reviews.some(
        (review) => review.score >= r.score && [...currentTypes].every((t) => review.types.has(t))
      );
      return !coveredByAPastReview;
    });
  }

  filtered.sort((a, b) => b.score - a.score || b.createdAt.localeCompare(a.createdAt));

  const total = filtered.length;
  const offset = (filters.page - 1) * TRIAGE_PAGE_SIZE;
  const pageRows = filtered.slice(offset, offset + TRIAGE_PAGE_SIZE);

  return { rows: pageRows, total };
}
