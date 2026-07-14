"use server";
import "server-only";

import { requireAdmin } from "@/lib/auth/requireAdmin";
import { createAdminClient } from "@/lib/supabase/admin";

export type RevealUserEmailResult = { email: string } | { error: string };

// Email is masked by default on the admin profile page; this is the
// separate, audited action that reveals it. Reason/category are fixed and
// auto-supplied here (not admin-typed) — the masking-by-default is the
// friction; a reveal is meant to be quick and low-friction, not require
// filling in a form.
export async function revealUserEmail(targetUserId: string): Promise<RevealUserEmailResult> {
  const admin_ = await requireAdmin();
  if (!admin_) return { error: "Unauthorized." };

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.getUserById(targetUserId);
  if (error || !data?.user?.email) return { error: "User not found." };

  await admin.from("moderation_actions").insert({
    moderator_user_id: admin_.id,
    action_type: "reveal_email",
    target_table: "auth_users",
    target_id: null,
    subject_user_id: targetUserId,
    reason: "Viewed on user profile page",
    reason_category: "other",
    snapshot: {},
  });

  return { email: data.user.email };
}
