// Shared throwaway-fixture helpers for db-tests — a fresh local Supabase
// instance (via `supabase start` in CI) has no seed data, unlike
// production, so every test creates exactly the rows it needs and cleans
// them up itself (same self-contained/cleanup-guaranteed style as v7.1's
// production verification scripts).
import crypto from "node:crypto";

export async function createTestBank(admin, namePrefix) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const { data, error } = await admin
    .from("banks")
    .insert({ name: `${namePrefix} ${suffix}`, slug: `${namePrefix.toLowerCase().replace(/\s+/g, "-")}-${suffix}` })
    .select("id, name")
    .single();
  if (error) throw error;
  return data;
}

// Creates a real auth user with a known password (not just via the admin
// API) so a test can later sign in as them through the anon-key client and
// genuinely exercise RLS-authenticated paths — the service-role client
// bypasses RLS entirely and can't prove a policy/trigger actually blocks
// anything.
export async function createTestUser(admin, label) {
  const email = `db-test-${label}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}@instantrailcheck-test.invalid`;
  const password = crypto.randomUUID();
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  return { id: data.user.id, email, password };
}

export async function deleteTestUser(admin, userId) {
  await admin.auth.admin.deleteUser(userId).catch(() => {});
}

export async function deleteTestBanks(admin, bankIds) {
  if (bankIds.length) await admin.from("banks").delete().in("id", bankIds);
}
