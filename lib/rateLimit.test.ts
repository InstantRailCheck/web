import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { getClientIp } from "./rateLimit";

function requestWithHeaders(headers: Record<string, string>): NextRequest {
  return new NextRequest("https://api.instantrailcheck.com/banks", { headers });
}

describe("getClientIp", () => {
  it("uses CF-Connecting-IP when present", () => {
    const ip = getClientIp(requestWithHeaders({ "cf-connecting-ip": "203.0.113.5" }));
    expect(ip).toBe("203.0.113.5");
  });

  it("falls back to the first X-Forwarded-For entry when CF-Connecting-IP is absent", () => {
    const ip = getClientIp(
      requestWithHeaders({ "x-forwarded-for": "203.0.113.9, 10.0.0.1, 10.0.0.2" })
    );
    expect(ip).toBe("203.0.113.9");
  });

  it("trims whitespace around the extracted X-Forwarded-For entry", () => {
    const ip = getClientIp(requestWithHeaders({ "x-forwarded-for": "  203.0.113.9  , 10.0.0.1" }));
    expect(ip).toBe("203.0.113.9");
  });

  it("prefers CF-Connecting-IP over a client-suppliable X-Forwarded-For", () => {
    // The whole point of this precedence, per the source comment: Cloudflare
    // appends to (rather than replaces) X-Forwarded-For, so a spoofed first
    // hop there could otherwise be used to cycle through fake IPs and evade
    // rate limiting. CF-Connecting-IP can't be spoofed the same way.
    const ip = getClientIp(
      requestWithHeaders({
        "cf-connecting-ip": "203.0.113.5",
        "x-forwarded-for": "1.2.3.4, 203.0.113.5",
      })
    );
    expect(ip).toBe("203.0.113.5");
  });

  it("returns 'unknown' when neither header is present", () => {
    const ip = getClientIp(requestWithHeaders({}));
    expect(ip).toBe("unknown");
  });
});
