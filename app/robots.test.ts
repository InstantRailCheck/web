import { describe, it, expect } from "vitest";
import robots from "./robots";

describe("robots", () => {
  it("disallows /admin alongside the other server-only surfaces", () => {
    const result = robots();
    expect(result.rules).toEqual(
      expect.objectContaining({
        disallow: expect.arrayContaining(["/admin", "/webhooks", "/account", "/api/"]),
      })
    );
  });
});
