import dns from "node:dns/promises";
import net from "node:net";

export type UrlSafetyResult = { safe: true } | { safe: false; reason: string };

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
    if (isPrivateOrReservedIp(addr)) {
      return { safe: false, reason: `Resolves to a private/reserved IP address (${addr})` };
    }
  }

  return { safe: true };
}

function isPrivateOrReservedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);

    if (a === 127) return true; // loopback
    if (a === 10) return true; // private
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 169 && b === 254) return true; // link-local — includes cloud metadata endpoints
    if (a === 0) return true; // "this" network
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }

  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === "::1") return true; // loopback
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local
    if (lower.startsWith("fe80")) return true; // link-local

    const v4Mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (v4Mapped) return isPrivateOrReservedIp(v4Mapped[1]);

    return false;
  }

  return true; // unrecognized format — fail closed
}
