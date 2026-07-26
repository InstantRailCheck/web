import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const isRateLimitedMock = vi.fn();
vi.mock("@/lib/rateLimit", () => ({
  isRateLimited: (...args: unknown[]) => isRateLimitedMock(...args),
  getClientIp: () => "203.0.113.5",
  secondsUntilRateLimitReset: () => 42,
}));

type ActivityItem = { type: string; id: string; bankId: string; bankSlug: string; bankName: string; createdAt: string };
const getActivityFeedMock = vi.fn<(...args: unknown[]) => Promise<ActivityItem[]>>();
vi.mock("@/lib/activityFeed", () => ({
  getActivityFeed: (...args: unknown[]) => getActivityFeedMock(...args),
}));

const { GET } = await import("./route");

function makeRequest(searchParams: Record<string, string> = {}) {
  const url = new URL("https://api.instantrailcheck.com/changelog");
  for (const [k, v] of Object.entries(searchParams)) url.searchParams.set(k, v);
  return new NextRequest(url, { headers: { host: "api.instantrailcheck.com" } });
}

beforeEach(() => {
  isRateLimitedMock.mockClear();
  isRateLimitedMock.mockResolvedValue(false);
  getActivityFeedMock.mockClear();
  getActivityFeedMock.mockResolvedValue([]);
});

describe("GET /api/changelog", () => {
  it("returns the activity feed as JSON by default", async () => {
    getActivityFeedMock.mockResolvedValue([
      { type: "bank_added", id: "1", bankId: "b1", bankSlug: "chase", bankName: "Chase", createdAt: "2026-01-01" },
    ]);
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.activity).toHaveLength(1);
  });

  it("returns CSV when format=csv", async () => {
    const res = await GET(makeRequest({ format: "csv" }));
    expect(res.headers.get("Content-Type")).toContain("text/csv");
  });

  it("checks rate limiting under the shared 'api:public:' namespace, not the bare IP", async () => {
    await GET(makeRequest());
    expect(isRateLimitedMock).toHaveBeenCalledWith("api:public:203.0.113.5");
  });

  it("returns 429 with a Retry-After header when rate-limited, without loading the feed", async () => {
    isRateLimitedMock.mockResolvedValue(true);
    const res = await GET(makeRequest());
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
    expect(getActivityFeedMock).not.toHaveBeenCalled();
  });

  it("marks the rate-limited response private, no-store", async () => {
    isRateLimitedMock.mockResolvedValue(true);
    const res = await GET(makeRequest());
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("keeps the shared public cache on a successful response", async () => {
    const res = await GET(makeRequest());
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=60, stale-while-revalidate=300");
  });
});
