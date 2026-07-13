-- Defense-in-depth follow-up to 20260713011500 (flagged by ChatGPT's
-- review of the completed v6.7.4 state): the no-op branch returned NEW
-- as-is, so a privileged caller that explicitly set updated_at while
-- changing every other column identically could make it "stick" -
-- since the branch never touched it either way. Confirmed no current
-- write path does this (all bank writes are server-only, and none of
-- them ever set updated_at directly), so this was not a practical
-- vulnerability, but it costs nothing to close: pin NEW.updated_at
-- back to OLD's value in the no-op branch, so the column is fully
-- caller-proof - only this trigger, never the caller, decides when it
-- moves - rather than "any current caller happens not to try."
create or replace function banks_set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (to_jsonb(new) - 'updated_at' - 'name_normalized')
     = (to_jsonb(old) - 'updated_at' - 'name_normalized') then
    new.updated_at = old.updated_at;
    return new;
  end if;
  new.updated_at = now();
  return new;
end;
$$;

notify pgrst, 'reload schema';
