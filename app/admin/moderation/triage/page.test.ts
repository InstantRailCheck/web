import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/requireAdmin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/riskTriage", () => ({ fetchTriageQueue: vi.fn(), TRIAGE_PAGE_SIZE: 20 }));
vi.mock("@/components/TriageFlagCard", () => ({ TriageFlagCard: () => null }));

const { parseDateBoundary } = await import("./page");

describe("parseDateBoundary", () => {
  it("returns null for an undefined or empty value", () => {
    expect(parseDateBoundary(undefined, "start")).toBeNull();
    expect(parseDateBoundary("", "start")).toBeNull();
  });

  it("returns null (never throws) for a malformed hand-edited date", () => {
    expect(parseDateBoundary("not-a-date", "start")).toBeNull();
    expect(parseDateBoundary("2026-13-40", "end")).toBeNull();
    expect(() => parseDateBoundary("garbage", "end")).not.toThrow();
  });

  it("pins 'start' to the beginning of the UTC day", () => {
    expect(parseDateBoundary("2026-07-10", "start")).toBe("2026-07-10T00:00:00.000Z");
  });

  it("pins 'end' to the end of the UTC day, not its start", () => {
    const result = parseDateBoundary("2026-07-10", "end");
    expect(result).toBe("2026-07-10T23:59:59.999Z");
    // The whole point of the fix: a row created at, say, 18:00 on the
    // selected "To" day must fall within [start, end] once both boundaries
    // are used together as a range.
    expect(new Date("2026-07-10T18:00:00.000Z").toISOString() <= result!).toBe(true);
  });
});
