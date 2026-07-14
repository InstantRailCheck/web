import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchBanksByIds } from "@/lib/needsFreshReports";

export const MODERATION_PAGE_SIZE = 20;

export type ModerationTargetTable = "route_reports" | "edd_reports" | "route_requests";
export const MODERATION_TARGET_TABLES: ModerationTargetTable[] = ["route_reports", "edd_reports", "route_requests"];

export type RouteReportModerationRow = {
  type: "route_reports";
  id: string;
  createdAt: string;
  attributable: boolean;
  userId: string | null;
  fromBankName: string;
  toBankName: string;
  railUsed: string | null;
  direction: string | null;
  status: string;
  testedAt: string | null;
  settlementTimeMinutes: number | null;
  sameDay: boolean | null;
  notes: string | null;
};

export type EddReportModerationRow = {
  type: "edd_reports";
  id: string;
  createdAt: string;
  attributable: boolean;
  userId: string | null;
  bankName: string;
  daysEarly: number;
  depositType: string | null;
  payrollProvider: string | null;
};

export type RouteRequestModerationRow = {
  type: "route_requests";
  id: string;
  createdAt: string;
  attributable: boolean;
  userId: string | null;
  fromBankName: string;
  toBankName: string;
  fulfilledAt: string | null;
};

export type ModerationRow = RouteReportModerationRow | EddReportModerationRow | RouteRequestModerationRow;

// Bank ids whose name matches the filter — the one lookup an admin
// responding to a specific complaint actually needs. Returns null (meaning
// "no filter, don't restrict") when bankFilter is blank, distinct from an
// empty array (meaning "filter given, nothing matched").
async function resolveMatchingBankIds(
  admin: ReturnType<typeof createAdminClient>,
  bankFilter: string
): Promise<string[] | null> {
  const trimmed = bankFilter.trim();
  if (!trimmed) return null;
  const { data, error } = await admin.from("banks").select("id").ilike("name", `%${trimmed}%`);
  if (error) throw error;
  return (data ?? []).map((b) => b.id as string);
}

// Server-side pagination (not the fetch-all-then-slice pattern
// lib/needsFreshReports.ts uses) — these tables can grow much larger than
// the small "needs fresh reports" aggregate, so an admin browsing recent
// submissions shouldn't require pulling every row on every page view.
export async function fetchModerationPage(
  targetTable: ModerationTargetTable,
  page: number,
  bankFilter: string
): Promise<{ rows: ModerationRow[]; total: number }> {
  const admin = createAdminClient();
  const offset = (page - 1) * MODERATION_PAGE_SIZE;
  const rangeEnd = offset + MODERATION_PAGE_SIZE - 1;

  if (targetTable === "route_reports") {
    // Filtering by bank id (resolved from the banks table), not a raw
    // ilike against the denormalized from_bank_name/to_bank_name text
    // columns directly — a name containing a comma (legal bank names
    // sometimes do, e.g. "Capital One, N.A.") would otherwise break
    // PostgREST's comma-delimited .or() filter syntax.
    const bankIds = await resolveMatchingBankIds(admin, bankFilter);
    if (bankIds !== null && bankIds.length === 0) return { rows: [], total: 0 };

    let query = admin
      .from("route_reports")
      .select(
        "id, from_bank_id, to_bank_id, from_bank_name, to_bank_name, rail_used, direction, status, tested_at, settlement_time_minutes, same_day, notes, user_id, created_at",
        { count: "exact" }
      )
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });

    if (bankIds !== null) {
      query = query.or(`from_bank_id.in.(${bankIds.join(",")}),to_bank_id.in.(${bankIds.join(",")})`);
    }

    const { data, error, count } = await query.range(offset, rangeEnd);
    if (error) throw error;

    const rows: RouteReportModerationRow[] = (data ?? []).map((r) => ({
      type: "route_reports",
      id: r.id,
      createdAt: r.created_at,
      attributable: r.user_id !== null,
      userId: r.user_id,
      fromBankName: r.from_bank_name,
      toBankName: r.to_bank_name,
      railUsed: r.rail_used,
      direction: r.direction,
      status: r.status,
      testedAt: r.tested_at,
      settlementTimeMinutes: r.settlement_time_minutes,
      sameDay: r.same_day,
      notes: r.notes,
    }));
    return { rows, total: count ?? 0 };
  }

  if (targetTable === "edd_reports") {
    const bankIds = await resolveMatchingBankIds(admin, bankFilter);
    if (bankIds !== null && bankIds.length === 0) return { rows: [], total: 0 };

    let query = admin
      .from("edd_reports")
      .select("id, bank_id, days_early, deposit_type, payroll_provider, user_id, created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    if (bankIds !== null) query = query.in("bank_id", bankIds);

    const { data, error, count } = await query.range(offset, rangeEnd);
    if (error) throw error;

    const banks = await fetchBanksByIds(admin, [...new Set((data ?? []).map((r) => r.bank_id as string))]);
    const bankNameById = new Map(banks.map((b) => [b.id, b.name]));

    const rows: EddReportModerationRow[] = (data ?? []).map((r) => ({
      type: "edd_reports",
      id: r.id,
      createdAt: r.created_at,
      attributable: r.user_id !== null,
      userId: r.user_id,
      bankName: bankNameById.get(r.bank_id) ?? "Unknown bank",
      daysEarly: r.days_early,
      depositType: r.deposit_type,
      payrollProvider: r.payroll_provider,
    }));
    return { rows, total: count ?? 0 };
  }

  // route_requests
  const bankIds = await resolveMatchingBankIds(admin, bankFilter);
  if (bankIds !== null && bankIds.length === 0) return { rows: [], total: 0 };

  let query = admin
    .from("route_requests")
    .select("id, from_bank_id, to_bank_id, user_id, created_at, fulfilled_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  if (bankIds !== null) {
    query = query.or(`from_bank_id.in.(${bankIds.join(",")}),to_bank_id.in.(${bankIds.join(",")})`);
  }

  const { data, error, count } = await query.range(offset, rangeEnd);
  if (error) throw error;

  const referencedBankIds = [...new Set((data ?? []).flatMap((r) => [r.from_bank_id, r.to_bank_id] as string[]))];
  const banks = await fetchBanksByIds(admin, referencedBankIds);
  const bankNameById = new Map(banks.map((b) => [b.id, b.name]));

  const rows: RouteRequestModerationRow[] = (data ?? []).map((r) => ({
    type: "route_requests",
    id: r.id,
    createdAt: r.created_at,
    attributable: r.user_id !== null,
    userId: r.user_id,
    fromBankName: bankNameById.get(r.from_bank_id) ?? "Unknown bank",
    toBankName: bankNameById.get(r.to_bank_id) ?? "Unknown bank",
    fulfilledAt: r.fulfilled_at,
  }));
  return { rows, total: count ?? 0 };
}

// ============================================================
// Per-user submission history — powers the admin profile page. Distinct
// from fetchModerationPage above: filtered by user_id (not bank name),
// includes two more sources (bank_corrections, bank_attributions) that
// aren't part of the main moderation page's remove-content tabs, and is
// read-only (no ModerateDeleteButton for bank corrections/additions in
// this release).
// ============================================================

export type BankCorrectionHistoryRow = {
  type: "bank_corrections";
  id: string;
  createdAt: string;
  bankName: string;
  field: string;
  submittedValue: string;
  previousValue: string | null;
  status: string;
};

export type BankAdditionHistoryRow = {
  type: "bank_attributions";
  id: string; // the added bank's id (bank_attributions' own primary key)
  createdAt: string;
  bankName: string;
};

export type UserHistoryRow =
  | RouteReportModerationRow
  | EddReportModerationRow
  | RouteRequestModerationRow
  | BankCorrectionHistoryRow
  | BankAdditionHistoryRow;

export type UserHistorySourceTable =
  | "route_reports"
  | "edd_reports"
  | "route_requests"
  | "bank_corrections"
  | "bank_attributions";

export const USER_HISTORY_SOURCE_TABLES: UserHistorySourceTable[] = [
  "route_reports",
  "edd_reports",
  "route_requests",
  "bank_corrections",
  "bank_attributions",
];

export async function fetchUserSubmissionPage(
  userId: string,
  sourceTable: UserHistorySourceTable,
  page: number
): Promise<{ rows: UserHistoryRow[]; total: number }> {
  const admin = createAdminClient();
  const offset = (page - 1) * MODERATION_PAGE_SIZE;
  const rangeEnd = offset + MODERATION_PAGE_SIZE - 1;

  if (sourceTable === "route_reports") {
    const { data, error, count } = await admin
      .from("route_reports")
      .select(
        "id, from_bank_id, to_bank_id, from_bank_name, to_bank_name, rail_used, direction, status, tested_at, settlement_time_minutes, same_day, notes, user_id, created_at",
        { count: "exact" }
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, rangeEnd);
    if (error) throw error;

    const rows: RouteReportModerationRow[] = (data ?? []).map((r) => ({
      type: "route_reports",
      id: r.id,
      createdAt: r.created_at,
      attributable: true,
      userId: r.user_id,
      fromBankName: r.from_bank_name,
      toBankName: r.to_bank_name,
      railUsed: r.rail_used,
      direction: r.direction,
      status: r.status,
      testedAt: r.tested_at,
      settlementTimeMinutes: r.settlement_time_minutes,
      sameDay: r.same_day,
      notes: r.notes,
    }));
    return { rows, total: count ?? 0 };
  }

  if (sourceTable === "edd_reports") {
    const { data, error, count } = await admin
      .from("edd_reports")
      .select("id, bank_id, days_early, deposit_type, payroll_provider, user_id, created_at", { count: "exact" })
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, rangeEnd);
    if (error) throw error;

    const banks = await fetchBanksByIds(admin, [...new Set((data ?? []).map((r) => r.bank_id as string))]);
    const bankNameById = new Map(banks.map((b) => [b.id, b.name]));

    const rows: EddReportModerationRow[] = (data ?? []).map((r) => ({
      type: "edd_reports",
      id: r.id,
      createdAt: r.created_at,
      attributable: true,
      userId: r.user_id,
      bankName: bankNameById.get(r.bank_id) ?? "Unknown bank",
      daysEarly: r.days_early,
      depositType: r.deposit_type,
      payrollProvider: r.payroll_provider,
    }));
    return { rows, total: count ?? 0 };
  }

  if (sourceTable === "route_requests") {
    const { data, error, count } = await admin
      .from("route_requests")
      .select("id, from_bank_id, to_bank_id, user_id, created_at, fulfilled_at", { count: "exact" })
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, rangeEnd);
    if (error) throw error;

    const referencedBankIds = [...new Set((data ?? []).flatMap((r) => [r.from_bank_id, r.to_bank_id] as string[]))];
    const banks = await fetchBanksByIds(admin, referencedBankIds);
    const bankNameById = new Map(banks.map((b) => [b.id, b.name]));

    const rows: RouteRequestModerationRow[] = (data ?? []).map((r) => ({
      type: "route_requests",
      id: r.id,
      createdAt: r.created_at,
      attributable: true,
      userId: r.user_id,
      fromBankName: bankNameById.get(r.from_bank_id) ?? "Unknown bank",
      toBankName: bankNameById.get(r.to_bank_id) ?? "Unknown bank",
      fulfilledAt: r.fulfilled_at,
    }));
    return { rows, total: count ?? 0 };
  }

  if (sourceTable === "bank_corrections") {
    const { data, error, count } = await admin
      .from("bank_corrections")
      .select("id, bank_id, field, submitted_value, previous_value, status, created_at", { count: "exact" })
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, rangeEnd);
    if (error) throw error;

    const banks = await fetchBanksByIds(admin, [...new Set((data ?? []).map((r) => r.bank_id as string))]);
    const bankNameById = new Map(banks.map((b) => [b.id, b.name]));

    const rows: BankCorrectionHistoryRow[] = (data ?? []).map((r) => ({
      type: "bank_corrections",
      id: r.id,
      createdAt: r.created_at,
      bankName: bankNameById.get(r.bank_id) ?? "Unknown bank",
      field: r.field,
      submittedValue: r.submitted_value,
      previousValue: r.previous_value,
      status: r.status,
    }));
    return { rows, total: count ?? 0 };
  }

  // bank_attributions
  const { data, error, count } = await admin
    .from("bank_attributions")
    .select("bank_id, added_by_user_id, created_at", { count: "exact" })
    .eq("added_by_user_id", userId)
    .order("created_at", { ascending: false })
    .order("bank_id", { ascending: false })
    .range(offset, rangeEnd);
  if (error) throw error;

  const banks = await fetchBanksByIds(admin, (data ?? []).map((r) => r.bank_id as string));
  const bankNameById = new Map(banks.map((b) => [b.id, b.name]));

  const rows: BankAdditionHistoryRow[] = (data ?? []).map((r) => ({
    type: "bank_attributions",
    id: r.bank_id,
    createdAt: r.created_at,
    bankName: bankNameById.get(r.bank_id) ?? "Unknown bank",
  }));
  return { rows, total: count ?? 0 };
}
