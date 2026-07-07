drop policy "public_insert" on route_reports;

create policy "authenticated_insert" on route_reports
for insert
to authenticated
with check (auth.uid() = user_id);
