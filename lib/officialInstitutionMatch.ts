import { lookupFdicBank, lookupFdicBankByCert, type FdicMatch } from "@/lib/fdicLookup";
import { lookupNcuaCreditUnion, lookupNcuaCreditUnionByCharter, type NcuaMatch } from "@/lib/ncuaLookup";
import { lookupFinraBroker, type FinraMatch } from "@/lib/finraLookup";

export type OfficialMatch = {
  fdicMatch: FdicMatch | null;
  ncuaMatch: NcuaMatch | null;
  finraMatch: FinraMatch | null;
};

export type BankForOfficialMatch = {
  name: string;
  fdic_cert: number | null;
  ncua_charter_number: number | null;
};

// Once a bank is linked to a real charter, every later lookup (re-
// enrichment, a correction's verification) must use that identifier
// directly rather than re-running a name search — a name-based re-lookup
// can silently resolve to a *different* charter sharing the same name
// once duplicate names are permitted (v8.0 §2). Only an unlinked bank
// falls back to the original name-based, FDIC-then-NCUA-then-FINRA
// priority search — FINRA has no identifier column in this schema, so it
// stays name-only regardless.
export async function resolveOfficialMatch(bank: BankForOfficialMatch): Promise<OfficialMatch> {
  if (bank.fdic_cert !== null) {
    return { fdicMatch: await lookupFdicBankByCert(bank.fdic_cert), ncuaMatch: null, finraMatch: null };
  }

  if (bank.ncua_charter_number !== null) {
    return { fdicMatch: null, ncuaMatch: await lookupNcuaCreditUnionByCharter(bank.ncua_charter_number), finraMatch: null };
  }

  const fdicMatch = await lookupFdicBank(bank.name);
  const ncuaMatch = fdicMatch ? null : await lookupNcuaCreditUnion(bank.name);
  const finraMatch = fdicMatch || ncuaMatch ? null : await lookupFinraBroker(bank.name);
  return { fdicMatch, ncuaMatch, finraMatch };
}
