// One-off admin: grant or revoke the admin moderation role for a user.
// Run with:
//   node --env-file=.env.local scripts/set-admin-role.mjs <user-uuid> [--revoke]
//
// The UUID is found via the Supabase Dashboard's Authentication -> Users
// list (already a trusted, project-owner-only channel) and passed as a
// runtime argument — never written into any committed file. app_metadata is
// the only field on a Supabase User the client can never write, which is
// exactly why lib/auth/requireAdmin.ts checks it rather than user_metadata.
// Revocation can also be done directly in the dashboard's raw app_metadata
// editor as an emergency fallback with no deploy required.

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const userId = process.argv[2];
const revoke = process.argv.includes("--revoke");

if (!userId || !/^[0-9a-f-]{36}$/i.test(userId)) {
  console.error("Usage: node --env-file=.env.local scripts/set-admin-role.mjs <user-uuid> [--revoke]");
  process.exit(1);
}

async function main() {
  const { data: existing, error: fetchError } = await supabase.auth.admin.getUserById(userId);
  if (fetchError) throw fetchError;
  if (!existing.user) {
    console.error(`No user found with id ${userId}`);
    process.exit(1);
  }

  // Whether updateUserById's app_metadata write merges with existing keys
  // or replaces the object wholesale isn't asserted here either way —
  // spreading the existing app_metadata first and sending the full result
  // back is correct under both behaviors, so this script doesn't need to
  // know which one the API actually implements.
  const nextAppMetadata = { ...existing.user.app_metadata };
  if (revoke) {
    delete nextAppMetadata.role;
  } else {
    nextAppMetadata.role = "admin";
  }

  const { error: updateError } = await supabase.auth.admin.updateUserById(userId, {
    app_metadata: nextAppMetadata,
  });
  if (updateError) throw updateError;

  console.log(
    revoke
      ? `Revoked admin role for ${userId}.`
      : `Granted admin role to ${userId}. They must sign out and back in for a client-held session to pick up the new app_metadata.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
