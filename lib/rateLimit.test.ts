import { NextRequest } from "next/server";
import { describe, expect, it, vi, beforeEach } from "vitest";

// rateLimit.ts imports lib/supabase/admin.ts, which is marked server-only —
// that package throws on import outside a real Next.js server build. Not
// something to enforce in a vitest run, so it's a no-op here.
vi.mock("server-only", () => ({}));

const rpcMock = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: rpcMock }),
}));

const headersMock = vi.fn();
vi.mock("next/headers", () => ({
  headers: () => headersMock(),
}));

const { getClientIp, getClientIpFromServerAction, isRateLimited, isActionRateLimited } = await import("./rateLimit");

function fakeHeaders(values: Record<string, string>) {
  return { get: (name: string) => values[name.toLowerCase()] ?? null };
}

beforeEach(() => {
  rpcMock.mockReset();
  headersMock.mockReset();
});

function requestWithHeaders(headers: Record<string, string>): NextRequest {
  return new NextRequest("https://api.instantrailcheck.com/banks", { headers });
}

describe("getClientIp", () => {
  it("ignores CF-Connecting-IP — the production deployment isn't behind Cloudflare, so it's attacker-controlled, not trustworthy", () => {
    const ip = getClientIp(requestWithHeaders({ "cf-connecting-ip": "203.0.113.5" }));
    expect(ip).toBe("unknown");
  });

  it("uses x-vercel-forwarded-for when present", () => {
    const ip = getClientIp(requestWithHeaders({ "x-vercel-forwarded-for": "203.0.113.9" }));
    expect(ip).toBe("203.0.113.9");
  });

  it("prefers x-vercel-forwarded-for over a spoofable CF-Connecting-IP", () => {
    const ip = getClientIp(
      requestWithHeaders({
        "cf-connecting-ip": "198.51.100.1",
        "x-vercel-forwarded-for": "203.0.113.9",
      })
    );
    expect(ip).toBe("203.0.113.9");
  });

  it("falls back to the first X-Forwarded-For entry when x-vercel-forwarded-for is absent", () => {
    const ip = getClientIp(
      requestWithHeaders({ "x-forwarded-for": "203.0.113.9, 10.0.0.1, 10.0.0.2" })
    );
    expect(ip).toBe("203.0.113.9");
  });

  it("trims whitespace around the extracted X-Forwarded-For entry", () => {
    const ip = getClientIp(requestWithHeaders({ "x-forwarded-for": "  203.0.113.9  , 10.0.0.1" }));
    expect(ip).toBe("203.0.113.9");
  });

  it("prefers x-vercel-forwarded-for over x-forwarded-for", () => {
    const ip = getClientIp(
      requestWithHeaders({
        "x-vercel-forwarded-for": "203.0.113.5",
        "x-forwarded-for": "1.2.3.4",
      })
    );
    expect(ip).toBe("203.0.113.5");
  });

  it("returns 'unknown' when no trusted header is present", () => {
    const ip = getClientIp(requestWithHeaders({}));
    expect(ip).toBe("unknown");
  });
});

describe("getClientIpFromServerAction", () => {
  it("reads x-vercel-forwarded-for from next/headers, same trust order as getClientIp", async () => {
    headersMock.mockResolvedValue(fakeHeaders({ "x-vercel-forwarded-for": "203.0.113.9" }));
    const ip = await getClientIpFromServerAction();
    expect(ip).toBe("203.0.113.9");
  });

  it("ignores cf-connecting-ip here too", async () => {
    headersMock.mockResolvedValue(fakeHeaders({ "cf-connecting-ip": "203.0.113.5" }));
    const ip = await getClientIpFromServerAction();
    expect(ip).toBe("unknown");
  });
});

describe("isRateLimited", () => {
  it("returns false when the count is within the limit", async () => {
    rpcMock.mockResolvedValue({ data: 5, error: null });
    expect(await isRateLimited("key", 10, 60)).toBe(false);
  });

  it("returns true once the count exceeds the limit", async () => {
    rpcMock.mockResolvedValue({ data: 11, error: null });
    expect(await isRateLimited("key", 10, 60)).toBe(true);
  });

  it("fails open (returns false) if the limiter RPC errors", async () => {
    rpcMock.mockResolvedValue({ data: null, error: new Error("db unavailable") });
    expect(await isRateLimited("key", 10, 60)).toBe(false);
  });
});

describe("isActionRateLimited", () => {
  beforeEach(() => {
    headersMock.mockResolvedValue(fakeHeaders({ "x-vercel-forwarded-for": "203.0.113.9" }));
  });

  it("blocks when the per-user count exceeds userLimit, even if the IP is fine", async () => {
    rpcMock.mockImplementation((_fn: string, { p_key }: { p_key: string }) =>
      Promise.resolve({ data: p_key.includes(":user:") ? 999 : 1, error: null })
    );
    const limited = await isActionRateLimited("addBank", "u1", { userLimit: 10, ipLimit: 20, windowSeconds: 600 });
    expect(limited).toBe(true);
  });

  it("blocks when the per-IP count exceeds ipLimit, even if the user is fine", async () => {
    rpcMock.mockImplementation((_fn: string, { p_key }: { p_key: string }) =>
      Promise.resolve({ data: p_key.includes(":ip:") ? 999 : 1, error: null })
    );
    const limited = await isActionRateLimited("addBank", "u1", { userLimit: 10, ipLimit: 20, windowSeconds: 600 });
    expect(limited).toBe(true);
  });

  it("allows the call when both user and IP are within their limits", async () => {
    rpcMock.mockResolvedValue({ data: 1, error: null });
    const limited = await isActionRateLimited("addBank", "u1", { userLimit: 10, ipLimit: 20, windowSeconds: 600 });
    expect(limited).toBe(false);
  });

  it("keys the user and IP counters separately, scoped by action name", async () => {
    rpcMock.mockResolvedValue({ data: 1, error: null });
    await isActionRateLimited("submitCorrection", "u1", { userLimit: 10, ipLimit: 20, windowSeconds: 600 });

    const keys = rpcMock.mock.calls.map(([, args]) => (args as { p_key: string }).p_key);
    expect(keys).toContain("action:submitCorrection:user:u1");
    expect(keys).toContain("action:submitCorrection:ip:203.0.113.9");
  });
});
