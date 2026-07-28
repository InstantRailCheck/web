import { describe, it, expect } from "vitest";
import { GET } from "./route";

describe("GET /api/ping", () => {
  it("returns 200 status ok with no auth or database access required", async () => {
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ status: "ok" });
  });

  it("sets no-store cache headers", async () => {
    const res = await GET();
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
