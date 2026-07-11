import { describe, it, expect } from "vitest";
import { sanitizeRedirectPath } from "./route";

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
