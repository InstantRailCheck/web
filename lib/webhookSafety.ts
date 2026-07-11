import dns from "node:dns/promises";
import ipaddr from "ipaddr.js";

export type UrlSafetyResult = { safe: true; address: string } | { safe: false; reason: string };

export async function isUrlSafeForWebhook(urlString: string): Promise<UrlSafetyResult> {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return { safe: false, reason: "Invalid URL" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { safe: false, reason: "Only http/https URLs are allowed" };
  }

  const hostname = url.hostname.toLowerCase();

  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return { safe: false, reason: "localhost is not allowed" };
  }

  let addresses: string[];
  try {
    const results = await dns.lookup(hostname, { all: true });
    addresses = results.map((r) => r.address);
  } catch {
    return { safe: false, reason: "Could not resolve hostname" };
  }

  if (addresses.length === 0) {
    return { safe: false, reason: "Could not resolve hostname" };
  }

  for (const addr of addresses) {
    if (!isGloballyRoutableIp(addr)) {
      return { safe: false, reason: `Resolves to a private/reserved IP address (${addr})` };
    }
  }

  // The caller pins the actual delivery connection to this exact address
  // (see triggerWebhooks.ts) rather than letting fetch() re-resolve the
  // hostname — a second, independent DNS lookup milliseconds later is
  // exactly the DNS-rebinding window a hostile nameserver can exploit,
  // returning a safe address here and a private one moments later.
  return { safe: true, address: addresses[0] };
}

// Allowlist, not a denylist: an address must parse and its ipaddr.js range
// must be exactly "unicast" (their term for "ordinary globally routable
// address") — anything unrecognized fails closed instead of silently
// passing through a range the list happened not to name. Covers both IPv4
// (private/loopback/linkLocal/multicast/broadcast/reserved/carrierGradeNat/
// as112/amt) and IPv6 (loopback/linkLocal/uniqueLocal/multicast/reserved/
// deprecatedSiteLocal/discard/6to4/teredo/benchmarking/orchid/and more) —
// see ipaddr.js's SpecialRanges tables, which track the IANA registries
// directly rather than a hand-maintained partial list.
function isGloballyRoutableIp(ip: string): boolean {
  let addr: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    // process() also unwraps an IPv4-mapped IPv6 address (::ffff:a.b.c.d)
    // into a plain IPv4 one, so it's checked against the IPv4 ranges rather
    // than only being recognized as the generic "ipv4Mapped" IPv6 range.
    addr = ipaddr.process(ip);
  } catch {
    return false; // unparseable — fail closed
  }

  return addr.range() === "unicast";
}
