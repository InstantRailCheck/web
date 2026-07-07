type FdicInstitution = {
  NAME: string;
  WEBADDR: string;
  ADDRESS: string;
  CITY: string;
  STALP: string;
  ZIP: string;
  ASSET: number;
};

export type FdicMatch = {
  website: string | null;
  address: string | null;
};

export async function lookupFdicBank(name: string): Promise<FdicMatch | null> {
  // Names in our database are often product names ("American Express Rewards
  // Checking") rather than the FDIC legal entity name ("American Express
  // National Bank"). Try the full name first, then progressively shorter
  // prefixes, stopping once something matches. Never truncate below 2 words
  // (for multi-word names) to avoid collapsing into a single generic term.
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
      const match = toMatch(candidates.reduce((a, b) => (b.ASSET > a.ASSET ? b : a)));
      if (match) return match;
    }
  }

  return null;
}

function toMatch(best: FdicInstitution): FdicMatch | null {

  const website = best.WEBADDR
    ? best.WEBADDR.startsWith("http")
      ? best.WEBADDR
      : `https://${best.WEBADDR}`
    : null;

  const address = best.ADDRESS
    ? [best.ADDRESS, best.CITY, best.STALP, best.ZIP].filter(Boolean).join(", ")
    : null;

  if (!website && !address) return null;

  return { website, address };
}

async function searchFdic(name: string): Promise<FdicInstitution[]> {
  const url = `https://api.fdic.gov/banks/institutions?search=${encodeURIComponent(
    `NAME:${quoteIfNeeded(name)}`
  )}&filters=ACTIVE:1&fields=NAME,WEBADDR,ADDRESS,CITY,STALP,ZIP,ASSET&sort_by=ASSET&sort_order=DESC&limit=5`;

  const res = await fetch(url);
  if (!res.ok) return [];

  const json = await res.json();
  return (json.data ?? []).map((d: any) => d.data);
}

function quoteIfNeeded(name: string): string {
  return name.includes(" ") ? `"${name}"` : name;
}
