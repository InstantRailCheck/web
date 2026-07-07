import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function searchFdic(name) {
  const url = `https://api.fdic.gov/banks/institutions?search=${encodeURIComponent(
    `NAME:${quoteIfNeeded(name)}`
  )}&filters=ACTIVE:1&fields=NAME,WEBADDR,ADDRESS,CITY,STALP,ZIP,ASSET&sort_by=ASSET&sort_order=DESC&limit=5`;

  const res = await fetch(url);
  if (!res.ok) return [];

  const json = await res.json();
  return (json.data ?? []).map((d) => d.data);
}

function quoteIfNeeded(name) {
  return name.includes(" ") ? `"${name}"` : name;
}

async function lookupFdicBank(name) {
  const words = name.trim().split(/\s+/);
  const floor = Math.min(2, words.length);

  for (let i = words.length; i >= floor; i--) {
    const candidateName = words.slice(0, i).join(" ");
    const variants = new Set([candidateName, candidateName.replace(/\bUS\b/gi, "U.S.")]);

    const candidateLists = await Promise.all(
      Array.from(variants).map((variant) => searchFdic(variant))
    );

    const candidates = candidateLists.flat();
    if (candidates.length > 0) {
      const best = candidates.reduce((a, b) => (b.ASSET > a.ASSET ? b : a));

      const website = best.WEBADDR
        ? best.WEBADDR.startsWith("http")
          ? best.WEBADDR
          : `https://${best.WEBADDR}`
        : null;

      const address = best.ADDRESS
        ? [best.ADDRESS, best.CITY, best.STALP, best.ZIP].filter(Boolean).join(", ")
        : null;

      if (website || address) return { website, address };
    }
  }

  return null;
}

const NCUA_SUFFIX_PATTERN = /\s+(federal credit union|credit union|fcu|cu)$/i;

async function tryNcuaMatch(name) {
  const normalized = name.toLowerCase().trim();
  if (!normalized) return null;

  const { data: exact } = await supabase
    .from("ncua_credit_unions")
    .select("website, address, phone")
    .contains("search_names", [normalized])
    .limit(1)
    .maybeSingle();

  if (exact && (exact.website || exact.address || exact.phone)) return exact;

  const { data: partial } = await supabase
    .from("ncua_credit_unions")
    .select("website, address, phone")
    .ilike("name", `%${normalized}%`)
    .limit(1)
    .maybeSingle();

  if (partial && (partial.website || partial.address || partial.phone)) return partial;

  return null;
}

async function lookupNcuaCreditUnion(name) {
  const stripped = name.trim().replace(NCUA_SUFFIX_PATTERN, "").trim();
  const candidates = Array.from(new Set([name.trim(), stripped]));

  for (const candidate of candidates) {
    const match = await tryNcuaMatch(candidate);
    if (match) return match;
  }

  const words = stripped.split(/\s+/);
  const floor = Math.min(2, words.length);

  for (let i = words.length - 1; i >= floor; i--) {
    const match = await tryNcuaMatch(words.slice(0, i).join(" "));
    if (match) return match;
  }

  return null;
}

async function searchFinra(name) {
  const url = `https://api.brokercheck.finra.org/search/firm?query=${encodeURIComponent(
    name
  )}&filter=active=true&includePrevious=true&hl=true&nrows=1&start=0&r=25&wt=json`;

  const res = await fetch(url);
  if (!res.ok) return null;

  const json = await res.json();
  const hit = json.hits?.hits?.[0]?._source;
  if (!hit) return null;

  let details;
  try {
    details = JSON.parse(hit.firm_address_details);
  } catch {
    return null;
  }

  const office = details?.officeAddress;
  const address = office
    ? [office.street1, office.city, office.state, office.postalCode].filter(Boolean).join(", ")
    : null;
  const phone = details?.businessPhoneNumber ?? null;

  if (!address && !phone) return null;

  return { website: null, address, phone };
}

async function lookupFinraBroker(name) {
  const words = name.trim().split(/\s+/);
  const floor = Math.min(2, words.length);

  for (let i = words.length; i >= floor; i--) {
    const match = await searchFinra(words.slice(0, i).join(" "));
    if (match) return match;
  }

  return null;
}

async function main() {
  const force = process.argv.includes("--force");
  const forceNames = process.argv
    .filter((a) => a.startsWith("--name="))
    .map((a) => a.slice("--name=".length));

  let query = supabase.from("banks").select("id, name, website, address, phone");
  if (!force) {
    query = query.or("website.is.null,website.eq.,address.is.null,phone.is.null");
  } else if (forceNames.length > 0) {
    query = query.in("name", forceNames);
  }

  const { data: banks, error } = await query;
  if (error) throw error;

  console.log(`Processing ${banks.length} bank(s).`);

  for (const bank of banks) {
    const fdicMatch = await lookupFdicBank(bank.name);
    const ncuaMatch = fdicMatch ? null : await lookupNcuaCreditUnion(bank.name);
    const finraMatch = fdicMatch || ncuaMatch ? null : await lookupFinraBroker(bank.name);
    const match = fdicMatch ?? ncuaMatch ?? finraMatch;
    const source = fdicMatch ? "FDIC" : ncuaMatch ? "NCUA" : finraMatch ? "FINRA" : null;

    if (!match) {
      console.log(`- ${bank.name}: no match in FDIC, NCUA, or FINRA — skipped`);
      continue;
    }

    let updateQuery = supabase
      .from("banks")
      .update({
        website: match.website,
        address: match.address,
        phone: match.phone ?? null,
      })
      .eq("id", bank.id);

    if (!forceNames.includes(bank.name)) {
      updateQuery = updateQuery.or("website.is.null,website.eq.");
    }

    const { error: updateError } = await updateQuery;

    if (updateError) {
      console.log(`- ${bank.name}: update failed — ${updateError.message}`);
    } else {
      console.log(`- ${bank.name}: enriched via ${source} (${match.website ?? "no website"})`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
