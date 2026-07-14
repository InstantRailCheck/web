"use server";
import "server-only";

import { requireAdmin } from "@/lib/auth/requireAdmin";
import { createAdminClient } from "@/lib/supabase/admin";
import { reconcileAuthSync } from "@/lib/authSync";

export type RetryAuthSyncResult = { success: true } | { error: string };

// A thin wrapper around reconcileAuthSync — always operates on whatever
// the current row says *now*, never on stale state passed in from an
// earlier page load, and is reachable regardless of the current
// auth_sync_status (not gated to only when it shows 'pending'): a synced
// flag can itself be stale if an older transition's Auth call lands after
// a newer one already marked itself synced — see lib/authSync.ts.
export async function retryAuthSync(targetUserId: string): Promise<RetryAuthSyncResult> {
  const admin_ = await requireAdmin();
  if (!admin_) return { error: "Unauthorized." };

  const admin = createAdminClient();
  const result = await reconcileAuthSync(admin, targetUserId);

  if (!result.synced) return { error: result.warning };
  return { success: true };
}
