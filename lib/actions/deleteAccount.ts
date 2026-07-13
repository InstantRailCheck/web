"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Deliberately thin — the actual data-erasure guarantee lives at the
// database boundary (see migration 20260711033000_add_account_deletion_fk_actions.sql
// and, for route_requests, 20260713050000_add_route_requests.sql), not
// here. route_reports/edd_reports/bank_corrections/route_requests rows are
// anonymized (user_id set null) rather than deleted, since every consumer
// of those tables already excludes unattributed rows from evidence/counts/
// the changelog/requestCount — the observable effect is identical to a
// hard delete without destroying the underlying community contribution.
// An anonymized route_requests row that's still active just keeps counting
// toward requestCount under user_id = null until it's fulfilled, same as
// any other anonymized row. webhooks (and via its own FK,
// webhook_deliveries) are fully deleted, since an orphaned webhook would
// otherwise keep firing with nobody able to manage it. Supabase's own
// auth.* tables (sessions, passkeys, OAuth links) cascade automatically.
export async function deleteAccount(): Promise<{ success: true } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "You must be signed in." };

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(user.id);

  if (error) {
    return { error: "Failed to delete account. Please try again or contact security@instantrailcheck.com." };
  }

  return { success: true };
}
