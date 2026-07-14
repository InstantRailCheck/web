import "server-only";
import { createClient } from "@/lib/supabase/server";

// app_metadata (not user_metadata) is the only field on a Supabase User
// that the client can never write — it's only settable server-side via the
// service-role Admin API (see scripts/set-admin-role.mjs). getUser() (not
// getSession()) is what this codebase already always uses for auth checks,
// since only getUser() revalidates against the Auth server rather than
// trusting a locally-decoded cookie.
export async function requireAdmin(): Promise<{ id: string } | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;
  if (user.app_metadata?.role !== "admin") return null;

  return { id: user.id };
}
