-- bank_corrections predates 20260714030000 (which closed this same
-- fresh-replay-vs-production grant gap for user_moderation_status,
-- bank_attributions, moderation_actions, and edd_reports) and was missed
-- at the time — confirmed directly: a fresh local `supabase db reset`
-- leaves service_role with only inherited default privileges (Dxtm) on
-- this table, not the full access production's dashboard-provisioned
-- history gives it. submitCorrection.ts's writes go through
-- apply_bank_correction (SECURITY DEFINER, owned by postgres) so this
-- was never actually exploitable in production, but any code or test
-- that reads/writes bank_corrections directly via the service-role
-- PostgREST client — including the new applyBankCorrection.check.mjs
-- db-test — needs this explicit grant to behave the same locally as in
-- production.
grant all privileges on table public.bank_corrections to service_role;

notify pgrst, 'reload schema';
