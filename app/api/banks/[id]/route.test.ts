import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const isRateLimitedMock = vi.fn();
vi.mock("@/lib/rateLimit", () => ({
  isRateLimited: (...args: unknown[]) => isRateLimitedMock(...args),
  getClientIp: () => "203.0.113.5",
  secondsUntilRateLimitReset: () => 42,
}));

type Profile = { bank: { id: string; name: string } | null };
let profileResult: Profile = { bank: null };
const getBankProfileByIdMock = vi.fn();
vi.mock("@/lib/bankProfile", () => ({
  getBankProfileById: (...args: unknown[]) => getBankProfileByIdMock(...args),
}));

const { GET } = await import("./route");

const VALID_ID = "00000000-0000-4000-8000-000000000001";

function makeRequest(id: string) {
  const url = new URL(`https://api.instantrailcheck.com/banks/${encodeURIComponent(id)}`);
  return {
    request: new NextRequest(url, { headers: { host: "api.instantrailcheck.com" } }),
    params: Promise.resolve({ id }),
  };
}

beforeEach(() => {
  isRateLimitedMock.mockClear();
  isRateLimitedMock.mockResolvedValue(false);
  getBankProfileByIdMock.mockClear();
  getBankProfileByIdMock.mockImplementation(() => Promise.resolve(profileResult));
  profileResult = { bank: { id: VALID_ID, name: "Test Bank" } };
});

describe("GET /api/banks/[id]", () => {
  it("returns the profile for a valid bank id", async () => {
    const { request, params } = makeRequest(VALID_ID);
    const res = await GET(request, { params });
    expect(res.status).toBe(200);
    expect(getBankProfileByIdMock).toHaveBeenCalledWith(VALID_ID);
  });

  it("returns 404 when the bank does not exist", async () => {
    profileResult = { bank: null };
    const { request, params } = makeRequest(VALID_ID);
    const res = await GET(request, { params });
    expect(res.status).toBe(404);
  });

  it.each(["not-a-uuid", "1", "'; drop table banks; --", "00000000-0000-4000-8000"])(
    "rejects a malformed id (%s) with a 400, distinct from the 404 'not found' case, and never queries the profile",
    async (id) => {
      const { request, params } = makeRequest(id);
      const res = await GET(request, { params });
      expect(res.status).toBe(400);
      expect(getBankProfileByIdMock).not.toHaveBeenCalled();
    }
  );

  it("checks rate limiting under the shared 'api:public:' namespace", async () => {
    const { request, params } = makeRequest(VALID_ID);
    await GET(request, { params });
    expect(isRateLimitedMock).toHaveBeenCalledWith("api:public:203.0.113.5");
  });

  it("returns 429 with a Retry-After header when rate-limited", async () => {
    isRateLimitedMock.mockResolvedValue(true);
    const { request, params } = makeRequest(VALID_ID);
    const res = await GET(request, { params });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
    expect(getBankProfileByIdMock).not.toHaveBeenCalled();
  });

  it("marks the 400 (malformed id) and 404 (not found) responses private, no-store", async () => {
    const malformed = await GET(makeRequest("not-a-uuid").request, { params: makeRequest("not-a-uuid").params });
    expect(malformed.headers.get("Cache-Control")).toBe("private, no-store");

    profileResult = { bank: null };
    const { request, params } = makeRequest(VALID_ID);
    const notFound = await GET(request, { params });
    expect(notFound.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("keeps the shared public cache on a successful response", async () => {
    const { request, params } = makeRequest(VALID_ID);
    const res = await GET(request, { params });
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=60, stale-while-revalidate=300");
  });
});
