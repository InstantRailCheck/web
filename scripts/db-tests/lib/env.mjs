// Resolves connection details for the LOCAL Supabase instance started by
// `npx supabase start` in CI (see .github/workflows/test.yml's `db-test`
// job) — never production. Prefers the running CLI's own machine-readable
// status output over any hardcoded value, since that's guaranteed correct
// for whatever instance was actually started; only falls back to the
// well-known fixed local-development defaults (identical across every
// local Supabase CLI instance, not secret) if the installed CLI version's
// status output can't be parsed.
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const FALLBACK_URL = "http://127.0.0.1:54321";
// Supabase's documented fixed local-development service-role key — the
// same for every `supabase start` instance everywhere, not a secret. Used
// only if `supabase status -o env` can't be parsed (see above).
const FALLBACK_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UtZGVtbyIsImlhdCI6MTY0MTc2OTIwMCwiZXhwIjoxNzk5NTM1NjAwfQ.DaYlNEoUrrEn2Ig7tqibS-PHK5vgusbcbo7X36XVt4Q";
const FALLBACK_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlLWRlbW8iLCJpYXQiOjE2NDE3NjkyMDAsImV4cCI6MTc5OTUzNTYwMH0.dc_X5iR_VP_qT0zsiyj_I_OZ2T9FtRU2BBNWN8Bu4GE";

function parseEnvOutput(output) {
  const vars = {};
  for (const line of output.split("\n")) {
    const match = line.match(/^([A-Z_]+)="?(.*?)"?$/);
    if (match) vars[match[1]] = match[2];
  }
  return vars;
}

export function resolveLocalSupabaseEnv() {
  try {
    const output = execFileSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf-8" });
    const vars = parseEnvOutput(output);
    if (vars.API_URL && vars.SERVICE_ROLE_KEY && vars.ANON_KEY) {
      return { url: vars.API_URL, serviceRoleKey: vars.SERVICE_ROLE_KEY, anonKey: vars.ANON_KEY };
    }
  } catch {
    // Fall through to fixed local-development defaults below.
  }
  return { url: FALLBACK_URL, serviceRoleKey: FALLBACK_SERVICE_ROLE_KEY, anonKey: FALLBACK_ANON_KEY };
}

export function createLocalAdminClient() {
  const { url, serviceRoleKey } = resolveLocalSupabaseEnv();
  return createClient(url, serviceRoleKey);
}

// Signs in as a specific test user (created with a known password) and
// returns a client whose requests carry that user's real access token —
// the only way to genuinely exercise an RLS policy (auth.uid() = user_id)
// rather than the service-role client, which bypasses RLS entirely.
export async function createLocalUserClient(email, password) {
  const { url, anonKey } = resolveLocalSupabaseEnv();
  const anon = createClient(url, anonKey);
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`Failed to sign in test user: ${error?.message}`);
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
  });
}
