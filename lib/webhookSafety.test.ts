import { beforeEach, describe, expect, it, vi } from "vitest";
import dns from "node:dns/promises";
import { isUrlSafeForWebhook } from "./webhookSafety";

vi.mock("node:dns/promises", () => ({
  default: { lookup: vi.fn() },
}));

function mockResolves(...addresses: Array<{ address: string; family: 4 | 6 }>) {
  vi.mocked(dns.lookup).mockResolvedValueOnce(addresses as never);
}

beforeEach(() => {
  vi.mocked(dns.lookup).mockReset();
});

describe("isUrlSafeForWebhook", () => {
  it("rejects an unparseable URL", async () => {
    const result = await isUrlSafeForWebhook("not a url");
    expect(result).toEqual({ safe: false, reason: "Invalid URL" });
  });

  it("rejects non-http(s) protocols", async () => {
    const result = await isUrlSafeForWebhook("ftp://example.com/hook");
    expect(result.safe).toBe(false);
  });

  it("rejects localhost", async () => {
    const result = await isUrlSafeForWebhook("http://localhost/hook");
    expect(result).toEqual({ safe: false, reason: "localhost is not allowed" });
  });

  it("rejects subdomains of .localhost", async () => {
    const result = await isUrlSafeForWebhook("http://foo.localhost/hook");
    expect(result.safe).toBe(false);
  });

  it("rejects when DNS resolution fails", async () => {
    vi.mocked(dns.lookup).mockRejectedValueOnce(new Error("ENOTFOUND"));
    const result = await isUrlSafeForWebhook("http://nonexistent.example/hook");
    expect(result).toEqual({ safe: false, reason: "Could not resolve hostname" });
  });

  it("rejects when DNS resolves to zero addresses", async () => {
    mockResolves();
    const result = await isUrlSafeForWebhook("http://example.com/hook");
    expect(result).toEqual({ safe: false, reason: "Could not resolve hostname" });
  });

  it("accepts a hostname that resolves to a public IPv4 address, returning it for connection-pinning", async () => {
    mockResolves({ address: "93.184.216.34", family: 4 });
    const result = await isUrlSafeForWebhook("http://example.com/hook");
    expect(result).toEqual({ safe: true, address: "93.184.216.34" });
  });

  it("accepts a hostname that resolves to a public IPv6 address", async () => {
    mockResolves({ address: "2001:4860:4860::8888", family: 6 });
    const result = await isUrlSafeForWebhook("http://example.com/hook");
    expect(result).toEqual({ safe: true, address: "2001:4860:4860::8888" });
  });

  it.each([
    ["loopback", "127.0.0.1"],
    ["private 10.x", "10.1.2.3"],
    ["private 172.16-31.x, lower boundary", "172.16.0.1"],
    ["private 172.16-31.x, upper boundary", "172.31.255.255"],
    ["private 192.168.x", "192.168.1.1"],
    ["link-local / cloud metadata (169.254.x)", "169.254.169.254"],
    ["'this' network (0.x)", "0.0.0.1"],
    ["CGNAT, lower boundary (100.64.x)", "100.64.0.1"],
    ["CGNAT, upper boundary (100.127.x)", "100.127.255.255"],
    ["multicast (224.x)", "224.0.0.1"],
    ["broadcast", "255.255.255.255"],
    ["documentation/TEST-NET-1 (192.0.2.x)", "192.0.2.1"],
    ["documentation/TEST-NET-2 (198.51.100.x)", "198.51.100.1"],
    ["documentation/TEST-NET-3 (203.0.113.x)", "203.0.113.1"],
    ["benchmarking (198.18-19.x)", "198.18.0.1"],
    ["reserved (240.x)", "240.0.0.1"],
    ["IETF protocol assignments (192.0.0.x)", "192.0.0.1"],
  ])("rejects %s", async (_label, ip) => {
    mockResolves({ address: ip, family: 4 });
    const result = await isUrlSafeForWebhook("http://example.com/hook");
    expect(result.safe).toBe(false);
  });

  it.each([
    ["just below the 172.16-31 private range", "172.15.255.255"],
    ["just above the 172.16-31 private range", "172.32.0.0"],
    ["just below the CGNAT range", "100.63.255.255"],
    ["just above the CGNAT range", "100.128.0.0"],
  ])("accepts an address %s (range boundary check)", async (_label, ip) => {
    mockResolves({ address: ip, family: 4 });
    const result = await isUrlSafeForWebhook("http://example.com/hook");
    expect(result).toEqual({ safe: true, address: ip });
  });

  it.each([
    ["IPv6 loopback", "::1"],
    ["IPv6 unique-local (fc00::/7, fc prefix)", "fc00::1"],
    ["IPv6 unique-local (fc00::/7, fd prefix)", "fd12:3456::1"],
    ["IPv6 link-local", "fe80::1"],
    ["IPv4-mapped IPv6 loopback", "::ffff:127.0.0.1"],
    ["IPv4-mapped IPv6 private", "::ffff:10.0.0.1"],
    ["IPv6 multicast", "ff02::1"],
    ["IPv6 documentation range (RFC3849)", "2001:db8::1"],
    ["IPv6 unspecified", "::"],
    ["6to4 (2002::/16)", "2002::1"],
    ["Teredo (2001::/32)", "2001::1"],
    ["IPv6 benchmarking (2001:2::/48)", "2001:2::1"],
  ])("rejects %s", async (_label, ip) => {
    mockResolves({ address: ip, family: 6 });
    const result = await isUrlSafeForWebhook("http://example.com/hook");
    expect(result.safe).toBe(false);
  });

  it("rejects if ANY resolved address is unsafe, even when others are public", async () => {
    mockResolves({ address: "93.184.216.34", family: 4 }, { address: "10.0.0.1", family: 4 });
    const result = await isUrlSafeForWebhook("http://example.com/hook");
    expect(result.safe).toBe(false);
  });

  it("accepts only when every resolved address is public, returning the first for pinning", async () => {
    mockResolves({ address: "93.184.216.34", family: 4 }, { address: "2001:4860:4860::8888", family: 6 });
    const result = await isUrlSafeForWebhook("http://example.com/hook");
    expect(result).toEqual({ safe: true, address: "93.184.216.34" });
  });
});
