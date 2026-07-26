import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const isRateLimitedMock = vi.fn();
vi.mock("@/lib/rateLimit", () => ({
  isRateLimited: (...args: unknown[]) => isRateLimitedMock(...args),
  getClientIp: () => "203.0.113.5",
  secondsUntilRateLimitReset: () => 42,
}));

type BankRow = { id: string; slug: string; name: string; city: string | null; state: string | null };

let queryResult: { data: BankRow[] | null; error: { message: string } | null } = { data: [], error: null };
let lastIlike: [string, string] | null = null;

function createQueryBuilder() {
  const builder: PromiseLike<typeof queryResult> & Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: () => builder,
    ilike: (col: string, val: string) => {
      lastIlike = [col, val];
      return builder;
    },
    then: (resolve: (value: typeof queryResult) => unknown) => resolve(queryResult),
  } as PromiseLike<typeof queryResult> & Record<string, unknown>;
  return builder;
}

const fromMock = vi.fn(() => createQueryBuilder());
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve({ from: fromMock }),
}));

const { GET } = await import("./route");

function makeRequest(searchParams: Record<string, string> = {}) {
  const url = new URL("https://www.instantrailcheck.com/api/bank-search");
  for (const [k, v] of Object.entries(searchParams)) url.searchParams.set(k, v);
  return new NextRequest(url);
}

beforeEach(() => {
  queryResult = { data: [], error: null };
  lastIlike = null;
  fromMock.mockClear();
  isRateLimitedMock.mockClear();
  isRateLimitedMock.mockResolvedValue(false);
});

describe("GET /api/bank-search", () => {
  it("returns banks from the query", async () => {
    queryResult = { data: [{ id: "1", slug: "chase", name: "Chase", city: null, state: null }], error: null };
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.banks).toHaveLength(1);
  });

  it("filters by the normalized q param when provided", async () => {
    await GET(makeRequest({ q: "chase" }));
    expect(lastIlike?.[0]).toBe("name_normalized");
    expect(lastIlike?.[1]).toContain("chase");
  });

  it("checks rate limiting under its own 'api:bank-search:' namespace, not the bare IP", async () => {
    await GET(makeRequest());
    expect(isRateLimitedMock).toHaveBeenCalledWith("api:bank-search:203.0.113.5");
  });

  it("returns 429 with a Retry-After header when rate-limited, without querying the DB", async () => {
    isRateLimitedMock.mockResolvedValue(true);
    const res = await GET(makeRequest());
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns a generic message and never the raw DB error on a query failure", async () => {
    queryResult = { data: null, error: { message: "column \"name_normalized\" does not exist: leaked schema detail" } };
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).not.toMatch(/column|schema/i);
  });

  it("marks error responses private, no-store", async () => {
    isRateLimitedMock.mockResolvedValue(true);
    const res = await GET(makeRequest());
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("keeps the shared public cache on a successful response", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=60, stale-while-revalidate=300");
  });
});
