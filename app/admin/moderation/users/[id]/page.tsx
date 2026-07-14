import "server-only";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveDirectoryPage } from "@/lib/seo";
import {
  fetchUserSubmissionPage,
  fetchUserModerationHistory,
  MODERATION_PAGE_SIZE,
  USER_HISTORY_SOURCE_TABLES,
  type UserHistorySourceTable,
  type UserHistoryRow,
} from "@/lib/moderation";
import { depositTypeLabel, payrollProviderLabel } from "@/lib/eddContext";
import { UserStatusButton } from "@/components/UserStatusButton";
import { AdminDeleteAccountButton } from "@/components/AdminDeleteAccountButton";
import { RevealEmailButton } from "@/components/RevealEmailButton";
import { RetryAuthSyncButton } from "@/components/RetryAuthSyncButton";

export const dynamic = "force-dynamic";

const SOURCE_LABELS: Record<UserHistorySourceTable, string> = {
  route_reports: "Route reports",
  edd_reports: "EDD reports",
  route_requests: "Route requests",
  bank_corrections: "Bank corrections",
  bank_attributions: "Bank additions",
};

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  restricted: "Restricted",
  temporarily_banned: "Temporarily suspended",
  permanently_banned: "Permanently banned",
};

function formatTimestamp(iso: string): string {
  return iso.replace("T", " ").replace(/\.\d+Z$/, "Z");
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  const visible = local.slice(0, 1);
  return `${visible}${"*".repeat(Math.max(local.length - 1, 3))}@${domain}`;
}

function buildPageUrl(id: string, type: UserHistorySourceTable, page: number): string {
  const usp = new URLSearchParams();
  usp.set("type", type);
  if (page > 1) usp.set("page", String(page));
  return `/admin/moderation/users/${id}?${usp.toString()}`;
}

function isUserHistorySourceTable(value: string | undefined): value is UserHistorySourceTable {
  return USER_HISTORY_SOURCE_TABLES.includes(value as UserHistorySourceTable);
}

function HistoryRowDetail({ row }: { row: UserHistoryRow }) {
  if (row.type === "route_reports") {
    return (
      <div className="flex flex-col text-sm text-slate-200">
        <span>
          {row.fromBankName} → {row.toBankName}
          {row.direction && <span className="text-slate-500"> · {row.direction}</span>}
        </span>
        <span className="text-xs text-slate-400">
          {row.railUsed ?? "Unknown rail"} · {row.status}
          {row.testedAt && ` · tested ${row.testedAt}`}
        </span>
      </div>
    );
  }
  if (row.type === "edd_reports") {
    return (
      <div className="flex flex-col text-sm text-slate-200">
        <span>{row.bankName}</span>
        <span className="text-xs text-slate-400">
          {row.daysEarly} day{row.daysEarly !== 1 ? "s" : ""} early
          {row.depositType && ` · ${depositTypeLabel(row.depositType) ?? row.depositType}`}
          {row.payrollProvider && ` · ${payrollProviderLabel(row.payrollProvider) ?? row.payrollProvider}`}
        </span>
      </div>
    );
  }
  if (row.type === "route_requests") {
    return (
      <div className="flex flex-col text-sm text-slate-200">
        <span>
          {row.fromBankName} → {row.toBankName}
        </span>
        <span className="text-xs text-slate-400">{row.fulfilledAt ? `Fulfilled ${row.fulfilledAt}` : "Active"}</span>
      </div>
    );
  }
  if (row.type === "bank_corrections") {
    return (
      <div className="flex flex-col text-sm text-slate-200">
        <span>{row.bankName}</span>
        <span className="text-xs text-slate-400">
          {row.field}: &ldquo;{row.submittedValue}&rdquo; ({row.status})
        </span>
      </div>
    );
  }
  return (
    <div className="flex flex-col text-sm text-slate-200">
      <span>{row.bankName}</span>
      <span className="text-xs text-slate-400">Bank added</span>
    </div>
  );
}

type SearchParams = { type?: string; page?: string };

export default async function AdminUserProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  // Independent of the admin nav not linking here — same reasoning as the
  // main moderation page: an unauthorized visitor gets a plain 404.
  const admin_ = await requireAdmin();
  if (!admin_) notFound();

  const { id } = await params;
  const admin = createAdminClient();

  const { data: targetUser, error: targetError } = await admin.auth.admin.getUserById(id);
  if (targetError || !targetUser?.user) notFound();
  const user = targetUser.user;

  const { data: moderationStatus } = await admin
    .from("user_moderation_status")
    .select("status, reason_category, note, ban_expires_at, auth_sync_status, auth_sync_error, updated_at")
    .eq("user_id", id)
    .maybeSingle();

  const { type: typeParam, page: pageParam } = await searchParams;
  const type: UserHistorySourceTable = isUserHistorySourceTable(typeParam) ? typeParam : "route_reports";
  const page = resolveDirectoryPage(pageParam);

  const [{ rows, total }, moderationHistory] = await Promise.all([
    fetchUserSubmissionPage(id, type, page),
    fetchUserModerationHistory(id),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / MODERATION_PAGE_SIZE));

  const status = moderationStatus?.status ?? "active";

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex w-full max-w-4xl flex-col px-6 pt-10 pb-16">
        <h1 className="text-center text-3xl font-bold">User profile</h1>

        <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
          <p className="text-sm text-slate-400">UUID</p>
          <p className="font-mono text-sm text-white">{user.id}</p>

          <p className="mt-4 text-sm text-slate-400">Email</p>
          <RevealEmailButton targetUserId={id} masked={maskEmail(user.email ?? "unknown@unknown")} />

          <p className="mt-4 text-sm text-slate-400">Account created</p>
          <p className="text-sm text-white">{user.created_at ? formatTimestamp(user.created_at) : "Unknown"}</p>

          <p className="mt-4 text-sm text-slate-400">Moderation status</p>
          <p className="text-sm font-semibold text-white">
            {STATUS_LABELS[status] ?? status}
            {moderationStatus?.status === "temporarily_banned" && moderationStatus.ban_expires_at && (
              <span className="ml-2 text-xs font-normal text-slate-400">
                until {formatTimestamp(moderationStatus.ban_expires_at)}
              </span>
            )}
          </p>
          {moderationStatus?.note && <p className="mt-1 text-xs text-slate-500">&ldquo;{moderationStatus.note}&rdquo;</p>}

          <div className="mt-3 flex flex-wrap items-center gap-3">
            {moderationStatus?.auth_sync_status === "pending" && (
              <RetryAuthSyncButton targetUserId={id} prominent errorMessage={moderationStatus.auth_sync_error} />
            )}
            <RetryAuthSyncButton targetUserId={id} prominent={false} errorMessage={null} />
          </div>

          <div className="mt-6 flex flex-wrap gap-3 border-t border-slate-800 pt-6">
            <UserStatusButton targetUserId={id} />
          </div>
          <div className="mt-4 border-t border-slate-800 pt-6">
            <AdminDeleteAccountButton targetUserId={id} />
          </div>
        </div>

        <h2 className="mt-10 text-center text-xl font-semibold">Moderation history</h2>
        <p className="mt-2 text-center text-sm text-slate-500">
          Includes removed submissions and account-level actions. Removed content itself is not retained here.
        </p>
        <div className="mt-4 grid gap-2">
          {moderationHistory.length === 0 ? (
            <p className="text-center text-sm text-slate-500">No moderation actions for this user.</p>
          ) : (
            moderationHistory.map((action) => (
              <div key={action.id} className="rounded-lg border border-slate-800 bg-slate-900/70 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-white">
                    {action.actionType.replaceAll("_", " ")} · {action.targetTable.replaceAll("_", " ")}
                  </p>
                  <p className="text-xs text-slate-500">{formatTimestamp(action.createdAt)}</p>
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  {action.reasonCategory}: {action.reason}
                </p>
              </div>
            ))
          )}
        </div>

        <h2 className="mt-10 text-center text-xl font-semibold">Submission history</h2>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {USER_HISTORY_SOURCE_TABLES.map((t) => (
            <a
              key={t}
              href={buildPageUrl(id, t, 1)}
              className={`rounded-full border px-4 py-1.5 text-sm font-medium transition ${
                t === type
                  ? "border-blue-500 bg-blue-950/40 text-white"
                  : "border-slate-700 text-slate-400 hover:border-slate-600"
              }`}
            >
              {SOURCE_LABELS[t]}
            </a>
          ))}
        </div>

        <p className="mt-4 text-center text-sm text-slate-500">
          {total} result{total !== 1 ? "s" : ""}
        </p>

        <div className="mt-4 grid gap-2">
          {rows.length === 0 ? (
            <p className="text-center text-sm text-slate-500">No submissions in this category.</p>
          ) : (
            rows.map((row) => (
              <div key={row.id} className="rounded-lg border border-slate-800 bg-slate-900/70 p-4">
                <HistoryRowDetail row={row} />
                <p className="mt-2 text-xs text-slate-500">{formatTimestamp(row.createdAt)}</p>
              </div>
            ))
          )}
        </div>

        {totalPages > 1 && (
          <div className="mt-6 flex items-center justify-center gap-4 text-sm">
            {page > 1 ? (
              <a href={buildPageUrl(id, type, page - 1)} className="text-blue-400 hover:text-blue-300 transition">
                ← Previous
              </a>
            ) : (
              <span className="text-slate-700">← Previous</span>
            )}
            <span className="text-slate-500">
              Page {page} of {totalPages}
            </span>
            {page < totalPages ? (
              <a href={buildPageUrl(id, type, page + 1)} className="text-blue-400 hover:text-blue-300 transition">
                Next →
              </a>
            ) : (
              <span className="text-slate-700">Next →</span>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
