-- v7.3 admin triage: "mark reviewed" on a flagged submission reuses the
-- existing moderation_actions audit table (action_type = 'review_flag')
-- rather than a new table — it already has RLS enabled with zero
-- policies, service-role-only access, and the target_table/target_id/
-- subject_user_id shape this needs exactly. The constraint's name is
-- already fixed by 20260714020000_add_user_moderation_status.sql (which
-- itself dynamically discovered and replaced whatever Postgres had
-- originally auto-named it), so no dynamic discovery is needed here.
alter table moderation_actions drop constraint moderation_actions_action_type_check;
alter table moderation_actions add constraint moderation_actions_action_type_check
  check (action_type in ('delete', 'restrict', 'suspend', 'ban', 'reactivate', 'delete_account', 'reveal_email', 'review_flag'));

notify pgrst, 'reload schema';
