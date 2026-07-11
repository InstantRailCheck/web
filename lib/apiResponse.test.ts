import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// apiResponse.ts imports rateLimit.ts, which imports lib/supabase/admin.ts —
// marked server-only, which throws on import outside a real Next.js server
// build. Not something to enforce in a vitest run, so it's a no-op here.
vi.mock("server-only", () => ({}));

import { legacyApiRedirect, withApiProtection } from "./apiResponse";
import { isRateLimited } from "./rateLimit";

vi.mock("./rateLimit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./rateLimit")>();
  return { ...actual, isRateLimited: vi.fn() };
});

function requestFor(url: string, host: string): NextRequest {
  return new NextRequest(url, { headers: { host } });
}

describe("legacyApiRedirect", () => {
  it("redirects www.instantrailcheck.com/api/* to the API subdomain", () => {
    const result = legacyApiRedirect(
      requestFor("https://www.instantrailcheck.com/api/banks", "www.instantrailcheck.com")
    );
    expect(result).not.toBeNull();
    expect(result!.status).toBe(308);
    expect(result!.headers.get("location")).toBe("https://api.instantrailcheck.com/banks");
  });

  it("redirects the bare apex domain (instantrailcheck.com) the same way", () => {
    const result = legacyApiRedirect(
      requestFor("https://instantrailcheck.com/api/changelog", "instantrailcheck.com")
    );
    expect(result).not.toBeNull();
    expect(result!.headers.get("location")).toBe("https://api.instantrailcheck.com/changelog");
  });

  it("preserves the query string", () => {
    const result = legacyApiRedirect(
      requestFor("https://www.instantrailcheck.com/api/banks?q=chase", "www.instantrailcheck.com")
    );
    expect(result!.headers.get("location")).toBe("https://api.instantrailcheck.com/banks?q=chase");
  });

  it("only strips the leading /api segment, not one that appears later in the path", () => {
    const result = legacyApiRedirect(
      requestFor("https://www.instantrailcheck.com/api/banks/api-test-id", "www.instantrailcheck.com")
    );
    expect(result!.headers.get("location")).toBe("https://api.instantrailcheck.com/banks/api-test-id");
  });

  it("does not redirect the API subdomain itself", () => {
    const result = legacyApiRedirect(
      requestFor("https://api.instantrailcheck.com/banks", "api.instantrailcheck.com")
    );
    expect(result).toBeNull();
  });

  it("does not redirect localhost", () => {
    const result = legacyApiRedirect(requestFor("http://localhost:3000/api/banks", "localhost:3000"));
    expect(result).toBeNull();
  });

  it("does not redirect Vercel preview deployments", () => {
    const result = legacyApiRedirect(
      requestFor("https://web-git-feature-branch.vercel.app/api/banks", "web-git-feature-branch.vercel.app")
    );
    expect(result).toBeNull();
  });
});

describe("withApiProtection", () => {
  beforeEach(() => {
    vi.mocked(isRateLimited).mockReset();
  });

  it("calls the wrapped handler and returns its response when allowed", async () => {
    vi.mocked(isRateLimited).mockResolvedValue(false);
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const wrapped = withApiProtection(handler);

    const request = requestFor("https://api.instantrailcheck.com/banks", "api.instantrailcheck.com");
    const response = await wrapped(request);

    expect(handler).toHaveBeenCalledOnce();
    expect(await response.json()).toEqual({ ok: true });
  });

  it("redirects a legacy host without calling the handler", async () => {
    vi.mocked(isRateLimited).mockResolvedValue(false);
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const wrapped = withApiProtection(handler);

    const request = requestFor("https://www.instantrailcheck.com/api/banks", "www.instantrailcheck.com");
    const response = await wrapped(request);

    expect(handler).not.toHaveBeenCalled();
    expect(response.status).toBe(308);
  });

  it("returns 429 without calling the handler when rate-limited", async () => {
    vi.mocked(isRateLimited).mockResolvedValue(true);
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const wrapped = withApiProtection(handler);

    const request = requestFor("https://api.instantrailcheck.com/banks", "api.instantrailcheck.com");
    const response = await wrapped(request);

    expect(handler).not.toHaveBeenCalled();
    expect(response.status).toBe(429);
  });

  it("passes extra route arguments (e.g. dynamic route params) through to the handler", async () => {
    vi.mocked(isRateLimited).mockResolvedValue(false);
    const handler = vi.fn(async (_request: NextRequest, context: { id: string }) =>
      NextResponse.json({ id: context.id })
    );
    const wrapped = withApiProtection(handler);

    const request = requestFor("https://api.instantrailcheck.com/banks/abc", "api.instantrailcheck.com");
    const response = await wrapped(request, { id: "abc" });

    expect(await response.json()).toEqual({ id: "abc" });
  });
});
