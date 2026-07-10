import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { legacyApiRedirect } from "./apiResponse";

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
