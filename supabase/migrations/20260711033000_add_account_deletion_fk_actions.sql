-- Enables self-service account deletion. Today, auth.admin.deleteUser()
-- would fail with a foreign key violation for any user who has ever
-- submitted a route report, an EDD report, a correction, or registered a
-- webhook — none of the four FKs referencing auth.users(id) from
-- application tables specify an ON DELETE action, so they default to NO
-- ACTION (blocks the delete). Supabase's own auth.* tables (sessions,
-- identities, webauthn credentials, etc.) already CASCADE correctly and
-- need no change here.
--
-- Two different treatments, matching what each table actually represents:
--
-- route_reports / edd_reports / bank_corrections: community evidence and
-- a moderation audit trail, not personal data anyone else depends on
-- being attributable. SET NULL rather than deleting the row outright —
-- every consumer of these tables (dedupeToNewestPerReporter,
-- getActivityFeed, etc.) already excludes user_id IS NULL rows from
-- evidence/counts/the changelog, so the *observable* effect is identical
-- to a hard delete (the contribution stops counting anywhere), while the
-- underlying row is preserved for audit/abuse-pattern purposes without
-- retaining anything that identifies who submitted it.
--
-- webhooks: a personal integration with no communal value — an orphaned
-- webhook would keep firing deliveries forever with nobody able to manage
-- or deactivate it. CASCADE (full delete) here, which in turn cascades to
-- webhook_deliveries via its existing FK to webhooks.

alter table edd_reports alter column user_id drop not null;
alter table bank_corrections alter column user_id drop not null;

alter table route_reports drop constraint route_reports_user_id_fkey;
alter table route_reports add constraint route_reports_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete set null;

alter table edd_reports drop constraint edd_reports_user_id_fkey;
alter table edd_reports add constraint edd_reports_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete set null;

alter table bank_corrections drop constraint bank_corrections_user_id_fkey;
alter table bank_corrections add constraint bank_corrections_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete set null;

alter table webhooks drop constraint webhooks_user_id_fkey;
alter table webhooks add constraint webhooks_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;
