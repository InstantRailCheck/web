export type FinraMatch = {
  address: string | null;
  phone: string | null;
};

export async function lookupFinraBroker(name: string): Promise<FinraMatch | null> {
  const words = name.trim().split(/\s+/);
  const floor = Math.min(2, words.length);

  for (let i = words.length; i >= floor; i--) {
    const candidate = words.slice(0, i).join(" ");
    const match = await searchFinra(candidate);
    if (match) return match;
  }

  return null;
}

async function searchFinra(name: string): Promise<FinraMatch | null> {
  const url = `https://api.brokercheck.finra.org/search/firm?query=${encodeURIComponent(
    name
  )}&filter=active=true&includePrevious=true&hl=true&nrows=1&start=0&r=25&wt=json`;

  const res = await fetch(url);
  if (!res.ok) return null;

  const json = await res.json();
  const hit = json.hits?.hits?.[0]?._source;
  if (!hit) return null;

  let details: any = null;
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

  return { address, phone };
}
