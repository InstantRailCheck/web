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

async function main() {
  const force = process.argv.includes("--force");
  const forceNames = process.argv
    .filter((a) => a.startsWith("--name="))
    .map((a) => a.slice("--name=".length));

  let query = supabase.from("banks").select("id, name, website, address");
  if (!force) {
    query = query.or("website.is.null,website.eq.,address.is.null");
  } else if (forceNames.length > 0) {
    query = query.in("name", forceNames);
  }

  const { data: banks, error } = await query;
  if (error) throw error;

  console.log(`Processing ${banks.length} bank(s).`);

  for (const bank of banks) {
    const match = await lookupFdicBank(bank.name);
    if (!match) {
      console.log(`- ${bank.name}: no confident FDIC match (likely a credit union — skipped)`);
      continue;
    }

    let updateQuery = supabase
      .from("banks")
      .update({ website: match.website, address: match.address })
      .eq("id", bank.id);

    if (!forceNames.includes(bank.name)) {
      updateQuery = updateQuery.or("website.is.null,website.eq.");
    }

    const { error: updateError } = await updateQuery;

    if (updateError) {
      console.log(`- ${bank.name}: update failed — ${updateError.message}`);
    } else {
      console.log(`- ${bank.name}: enriched (${match.website ?? "no website"})`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
