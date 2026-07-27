import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { sanitizeRedirectPath, trustedRedirectBase } from "./route";

const exchangeCodeForSessionMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve({ auth: { exchangeCodeForSession: exchangeCodeForSessionMock } }),
}));

const logErrorMock = vi.fn();
vi.mock("@/lib/logger", () => ({
  logError: (...args: unknown[]) => logErrorMock(...args),
}));

const { GET } = await import("./route");

describe("sanitizeRedirectPath", () => {
  it("defaults to / when next is missing", () => {
    expect(sanitizeRedirectPath(null)).toBe("/");
  });

  it("keeps a valid internal path", () => {
    expect(sanitizeRedirectPath("/account")).toBe("/account");
  });

  it("keeps a valid internal path with query and hash", () => {
    expect(sanitizeRedirectPath("/banks/chase?tab=reports#top")).toBe("/banks/chase?tab=reports#top");
  });

  it("rejects an absolute URL to another host", () => {
    expect(sanitizeRedirectPath("https://attacker.example")).toBe("/");
  });

  it("rejects an absolute URL to another host with a trailing valid-looking path", () => {
    expect(sanitizeRedirectPath("https://attacker.example/account")).toBe("/");
  });

  it("rejects a protocol-relative //host redirect", () => {
    expect(sanitizeRedirectPath("//attacker.example")).toBe("/");
  });

  it.each([
    ["single backslash after slash", "/\\attacker.example"],
    ["leading backslash", "\\/attacker.example"],
    ["double backslash", "\\\\attacker.example"],
  ])("rejects a backslash bypass (%s)", (_label, payload) => {
    expect(sanitizeRedirectPath(payload)).toBe("/");
  });

  it.each([
    ["tab", "/\t/attacker.example"],
    ["newline", "/\n/attacker.example"],
    ["carriage return", "/\r/attacker.example"],
  ])("rejects a %s-stripping bypass that the URL parser would otherwise resolve off-site", (_label, payload) => {
    expect(sanitizeRedirectPath(payload)).toBe("/");
  });

  it("rejects a percent-encoded protocol-relative redirect", () => {
    // URLSearchParams.get() already decodes this before it reaches
    // sanitizeRedirectPath, so this exercises the decoded form directly.
    expect(sanitizeRedirectPath("//attacker.example")).toBe("/");
  });

  it("rejects a value with an explicit scheme masquerading as a path", () => {
    expect(sanitizeRedirectPath("javascript:alert(1)")).toBe("/");
  });

  it("falls back to / for an unparseable value", () => {
    expect(sanitizeRedirectPath("http://")).toBe("/");
  });
});

describe("trustedRedirectBase", () => {
  it("uses the request's own origin for the production site", () => {
    const request = new NextRequest("https://www.instantrailcheck.com/auth/callback");
    expect(trustedRedirectBase(request)).toBe("https://www.instantrailcheck.com");
  });

  it("uses the request's own origin for local dev (localhost:3000)", () => {
    const request = new NextRequest("http://localhost:3000/auth/callback");
    expect(trustedRedirectBase(request)).toBe("http://localhost:3000");
  });

  it("falls back to the fixed trusted origin for a Vercel preview deployment", () => {
    const request = new NextRequest("https://web-git-feature-branch.vercel.app/auth/callback");
    expect(trustedRedirectBase(request)).toBe("https://www.instantrailcheck.com");
  });

  it("falls back to the fixed trusted origin for an arbitrary/spoofed Host", () => {
    const request = new NextRequest("https://attacker.example/auth/callback");
    expect(trustedRedirectBase(request)).toBe("https://www.instantrailcheck.com");
  });
});

describe("GET /auth/callback", () => {
  beforeEach(() => {
    exchangeCodeForSessionMock.mockReset();
    logErrorMock.mockReset();
  });

  it("redirects to next on a successful code exchange", async () => {
    exchangeCodeForSessionMock.mockResolvedValue({ error: null });
    const request = new NextRequest("https://www.instantrailcheck.com/auth/callback?code=abc123&next=%2Fcontribute");

    const response = await GET(request);

    expect(response.headers.get("location")).toBe("https://www.instantrailcheck.com/contribute");
    expect(logErrorMock).not.toHaveBeenCalled();
  });

  it("logs the real error and redirects to the generic auth_error banner when the code exchange fails", async () => {
    exchangeCodeForSessionMock.mockResolvedValue({ error: { message: "invalid_grant: code already used" } });
    const request = new NextRequest("https://www.instantrailcheck.com/auth/callback?code=abc123");

    const response = await GET(request);

    expect(response.headers.get("location")).toBe("https://www.instantrailcheck.com/?auth_error=1");
    expect(logErrorMock).toHaveBeenCalledWith(
      "OAuth code exchange failed in /auth/callback",
      { error: "invalid_grant: code already used" }
    );
  });

  it("logs the provider's own error/error_description when no code is present at all (e.g. a misconfigured provider secret or redirect URI)", async () => {
    const request = new NextRequest(
      "https://www.instantrailcheck.com/auth/callback?error=server_error&error_description=Unable+to+exchange+external+code"
    );

    const response = await GET(request);

    expect(response.headers.get("location")).toBe("https://www.instantrailcheck.com/?auth_error=1");
    expect(exchangeCodeForSessionMock).not.toHaveBeenCalled();
    expect(logErrorMock).toHaveBeenCalledWith(
      "OAuth provider returned an error in /auth/callback",
      { error: "server_error", description: "Unable to exchange external code" }
    );
  });

  it("redirects to the generic auth_error banner without logging when there's simply no code and no provider error (e.g. a direct/bare hit on the route)", async () => {
    const request = new NextRequest("https://www.instantrailcheck.com/auth/callback");

    const response = await GET(request);

    expect(response.headers.get("location")).toBe("https://www.instantrailcheck.com/?auth_error=1");
    expect(logErrorMock).not.toHaveBeenCalled();
  });
});
