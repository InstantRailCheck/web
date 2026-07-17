import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/rateLimit", () => ({
  isRateLimited: vi.fn(() => Promise.resolve(false)),
  getClientIp: vi.fn(() => "127.0.0.1"),
}));

type BankRow = {
  id: string;
  slug: string;
  name: string;
  website: string | null;
  address: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  aka_names: string[] | null;
  fednow_participant: boolean | null;
  rtp_participant: boolean | null;
  zelle_participant: boolean | null;
};

function makeBank(i: number): BankRow {
  return {
    id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    slug: `representative-community-bank-${i}`,
    name: `Representative Community Bank ${i} National Association`,
    website: "https://www.representativebank.example",
    address: "123 Main Street, Suite 400, Springfield, IL 62701",
    phone: "217-555-0100",
    city: "Springfield",
    state: "IL",
    aka_names: ["RCB", "Representative Bank"],
    fednow_participant: true,
    rtp_participant: false,
    zelle_participant: true,
  };
}

let queryResult: { data: BankRow[]; error: { message: string } | null; count: number } = {
  data: [],
  error: null,
  count: 0,
};
let lastFilters: {
  eqCalls: Array<[string, unknown]>;
  ilikeCalls: Array<[string, string]>;
  rangeCall: [number, number] | null;
  selectColumns: string | null;
} = {
  eqCalls: [],
  ilikeCalls: [],
  rangeCall: null,
  selectColumns: null,
};

function createQueryBuilder() {
  const builder: PromiseLike<typeof queryResult> & Record<string, unknown> = {
    select: (columns: string) => {
      lastFilters.selectColumns = columns;
      return builder;
    },
    eq: (col: string, val: unknown) => {
      lastFilters.eqCalls.push([col, val]);
      return builder;
    },
    ilike: (col: string, val: string) => {
      lastFilters.ilikeCalls.push([col, val]);
      return builder;
    },
    order: () => builder,
    range: (from: number, to: number) => {
      lastFilters.rangeCall = [from, to];
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
  const url = new URL("https://api.instantrailcheck.com/banks");
  for (const [k, v] of Object.entries(searchParams)) url.searchParams.set(k, v);
  return new NextRequest(url, { headers: { host: "api.instantrailcheck.com" } });
}

beforeEach(() => {
  queryResult = { data: [], error: null, count: 0 };
  lastFilters = { eqCalls: [], ilikeCalls: [], rangeCall: null, selectColumns: null };
  fromMock.mockClear();
});

describe("GET /api/banks", () => {
  it("filters to is_active=true by default", async () => {
    queryResult = { data: [makeBank(1)], error: null, count: 1 };
    await GET(makeRequest());
    expect(lastFilters.eqCalls).toContainEqual(["is_active", true]);
  });

  it("does not filter by is_active when include_inactive=true", async () => {
    queryResult = { data: [makeBank(1)], error: null, count: 1 };
    await GET(makeRequest({ include_inactive: "true" }));
    expect(lastFilters.eqCalls.some(([col]) => col === "is_active")).toBe(false);
  });

  it("caps an explicit limit at MAX_LIMIT (500)", async () => {
    queryResult = { data: [], error: null, count: 0 };
    await GET(makeRequest({ limit: "10000" }));
    expect(lastFilters.rangeCall).toEqual([0, 499]);
  });

  it("JSON response reports truncated=true and the correct next_offset when more rows remain", async () => {
    queryResult = { data: [makeBank(1), makeBank(2)], error: null, count: 10 };
    const res = await GET(makeRequest({ limit: "2", offset: "0" }));
    const body = await res.json();
    expect(body.truncated).toBe(true);
    expect(body.next_offset).toBe(2);
    expect(body.total).toBe(10);
  });

  it("JSON response reports truncated=false and next_offset=null on the last page", async () => {
    queryResult = { data: [makeBank(1)], error: null, count: 1 };
    const res = await GET(makeRequest({ limit: "50", offset: "0" }));
    const body = await res.json();
    expect(body.truncated).toBe(false);
    expect(body.next_offset).toBeNull();
  });

  it("CSV response carries the same pagination metadata as JSON, via headers", async () => {
    queryResult = { data: [makeBank(1), makeBank(2)], error: null, count: 10 };
    const res = await GET(makeRequest({ format: "csv", limit: "2", offset: "0" }));
    expect(res.headers.get("X-Total-Count")).toBe("10");
    expect(res.headers.get("X-Truncated")).toBe("true");
    expect(res.headers.get("X-Next-Offset")).toBe("2");
  });

  it("CSV response's X-Next-Offset header is empty (not the string 'null') when nothing remains", async () => {
    queryResult = { data: [makeBank(1)], error: null, count: 1 };
    const res = await GET(makeRequest({ format: "csv" }));
    expect(res.headers.get("X-Next-Offset")).toBe("");
  });

  it("selects city and state alongside the existing fields", async () => {
    queryResult = { data: [makeBank(1)], error: null, count: 1 };
    await GET(makeRequest());
    expect(lastFilters.selectColumns).toContain("city");
    expect(lastFilters.selectColumns).toContain("state");
  });

  it("the unpaginated default cap (5,000 rows) produces a JSON payload comfortably under Vercel's 4.5MB function response limit", async () => {
    // Not a guess: a representative row (typical name/address/website
    // length, aka_names populated, all three rail flags present) repeated
    // at the full DEFAULT_UNPAGINATED_CAP, measured as real UTF-8 bytes.
    // An earlier version of this test caught DEFAULT_UNPAGINATED_CAP=10,000
    // measuring ~4.4MB with this exact row shape — dangerously close to the
    // real 4.5MB limit on its own, before any other response overhead. The
    // cap was lowered to 5,000 as a direct result; this assertion targets
    // roughly half that measured density, not an arbitrary round number.
    const CAP = 5000;
    const VERCEL_LIMIT_BYTES = 4.5 * 1024 * 1024;
    const SAFE_TARGET_BYTES = 2.5 * 1024 * 1024;

    const rows = Array.from({ length: CAP }, (_, i) => makeBank(i));
    queryResult = { data: rows, error: null, count: CAP };

    const res = await GET(makeRequest());
    const bodyText = await res.text();
    const bytes = new TextEncoder().encode(bodyText).length;

    expect(bytes).toBeLessThan(SAFE_TARGET_BYTES);
    expect(bytes).toBeLessThan(VERCEL_LIMIT_BYTES);
  });
});
