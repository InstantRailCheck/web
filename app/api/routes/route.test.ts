import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const isRateLimitedMock = vi.fn();
vi.mock("@/lib/rateLimit", () => ({
  isRateLimited: (...args: unknown[]) => isRateLimitedMock(...args),
  getClientIp: () => "203.0.113.5",
  secondsUntilRateLimitReset: () => 42,
}));

const getRouteIntelligenceMock = vi.fn();
vi.mock("@/lib/routingEngine", () => ({
  getRouteIntelligence: (...args: unknown[]) => getRouteIntelligenceMock(...args),
}));

const { GET } = await import("./route");

const VALID_FROM = "00000000-0000-4000-8000-000000000001";
const VALID_TO = "00000000-0000-4000-8000-000000000002";

function makeRequest(searchParams: Record<string, string> = {}) {
  const url = new URL("https://api.instantrailcheck.com/routes");
  for (const [k, v] of Object.entries(searchParams)) url.searchParams.set(k, v);
  return new NextRequest(url, { headers: { host: "api.instantrailcheck.com" } });
}

beforeEach(() => {
  isRateLimitedMock.mockClear();
  isRateLimitedMock.mockResolvedValue(false);
  getRouteIntelligenceMock.mockClear();
  getRouteIntelligenceMock.mockResolvedValue({ rails: [] });
});

describe("GET /api/routes", () => {
  it("returns route intelligence for two valid bank id UUIDs", async () => {
    const res = await GET(makeRequest({ from: VALID_FROM, to: VALID_TO }));
    expect(res.status).toBe(200);
    expect(getRouteIntelligenceMock).toHaveBeenCalledWith(VALID_FROM, VALID_TO);
  });

  it("requires both 'from' and 'to'", async () => {
    const res = await GET(makeRequest({ from: VALID_FROM }));
    expect(res.status).toBe(400);
    expect(getRouteIntelligenceMock).not.toHaveBeenCalled();
  });

  it.each([
    ["from", "not-a-uuid", VALID_TO],
    ["to", VALID_FROM, "'; drop table banks; --"],
    ["from", "00000000-0000-4000-8000", VALID_TO],
  ])("rejects a malformed %s id with a 400 and never queries the routing engine", async (_label, from, to) => {
    const res = await GET(makeRequest({ from, to }));
    expect(res.status).toBe(400);
    expect(getRouteIntelligenceMock).not.toHaveBeenCalled();
  });

  it("checks rate limiting under the shared 'api:public:' namespace", async () => {
    await GET(makeRequest({ from: VALID_FROM, to: VALID_TO }));
    expect(isRateLimitedMock).toHaveBeenCalledWith("api:public:203.0.113.5");
  });

  it("returns 429 with a Retry-After header when rate-limited", async () => {
    isRateLimitedMock.mockResolvedValue(true);
    const res = await GET(makeRequest({ from: VALID_FROM, to: VALID_TO }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
    expect(getRouteIntelligenceMock).not.toHaveBeenCalled();
  });

  it("marks error responses private, no-store", async () => {
    const res = await GET(makeRequest({ from: "not-a-uuid", to: VALID_TO }));
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("keeps the shared public cache on a successful response", async () => {
    const res = await GET(makeRequest({ from: VALID_FROM, to: VALID_TO }));
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=60, stale-while-revalidate=300");
  });
});
