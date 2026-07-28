-- Supports lib/similarInstitutions.ts's getSimilarBanks() query, which runs
-- on every one of ~4,670 bank profile page renders (state + source_authority
-- match, active only). Nothing currently supports this filter combination.
-- Partial on is_active (only active rows are ever queried this way) and
-- CONCURRENTLY per PROJECT.md's Build Rules, since banks takes writes during
-- normal sync operation.
create index concurrently if not exists banks_state_authority_active_idx
  on banks (state, source_authority)
  where is_active;
