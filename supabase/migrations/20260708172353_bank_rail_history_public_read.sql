-- bank_rail_history was created service-role-only, but it's now read by the
-- public bank profile page (rail evidence cards) using the anon/publishable
-- key. This data isn't sensitive — it's the same rail-participation facts
-- already shown publicly via banks.fednow_participant etc., just with
-- per-change timestamps — so a public read policy is appropriate, unlike
-- bank_corrections or webhooks which hold genuinely sensitive state.

create policy "bank_rail_history is publicly readable"
  on bank_rail_history
  for select
  to anon, authenticated
  using (true);

notify pgrst, 'reload schema';
