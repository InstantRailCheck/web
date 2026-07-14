-- Fresh migration replays do not inherit the same dashboard-created default
-- privileges as production. Make v7.2's server-only table/function grants
-- explicit so local CI exercises the real behavior instead of failing at the
-- SQL privilege layer. RLS remains enabled with zero client policies.

grant all privileges on table public.user_moderation_status to service_role;
grant all privileges on table public.bank_attributions to service_role;
grant all privileges on table public.moderation_actions to service_role;
grant all privileges on table public.edd_reports to service_role;

-- The enforcement regression test intentionally inserts as an authenticated
-- user to prove the database trigger cannot be bypassed. RLS and the trigger
-- still determine whether a row is accepted.
grant insert on table public.edd_reports to authenticated;

grant execute on function public.add_bank_with_attribution(text, text, uuid) to service_role;
grant execute on function public.moderate_set_user_status(uuid, uuid, text, text, text, integer) to service_role;
grant execute on function public.moderate_delete_submission(text, uuid, uuid, text, text) to service_role;

notify pgrst, 'reload schema';
