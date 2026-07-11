import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchWithTimeoutAndRetry } from "./fetchWithTimeout.mjs";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

beforeEach(() => {
  fetchMock.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

async function withAdvancingTimers(promise) {
  const done = promise;
  await vi.advanceTimersByTimeAsync(60_000);
  return done;
}

function okResponse() {
  return { ok: true, status: 200 };
}
function errorResponse(status) {
  return { ok: false, status };
}

describe("fetchWithTimeoutAndRetry (scripts)", () => {
  it("returns the response on a successful first attempt", async () => {
    fetchMock.mockResolvedValueOnce(okResponse());
    const res = await fetchWithTimeoutAndRetry("https://example.com", { retries: 1 });
    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries on a network error and succeeds on the second attempt", async () => {
    fetchMock.mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce(okResponse());
    const res = await withAdvancingTimers(fetchWithTimeoutAndRetry("https://example.com", { retries: 1 }));
    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries on a non-2xx response and succeeds on the second attempt", async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(503)).mockResolvedValueOnce(okResponse());
    const res = await withAdvancingTimers(fetchWithTimeoutAndRetry("https://example.com", { retries: 1 }));
    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("re-throws the last network error after exhausting retries", async () => {
    fetchMock.mockRejectedValue(new Error("still down"));
    // Attach the rejection handler synchronously (via expect(...).rejects)
    // before advancing fake timers, so Node never sees a tick where the
    // rejected promise has no handler attached yet.
    const promise = fetchWithTimeoutAndRetry("https://example.com", { retries: 1 });
    const assertion = expect(promise).rejects.toThrow("still down");
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns the last non-ok response (not a throw) after exhausting retries", async () => {
    fetchMock.mockResolvedValue(errorResponse(500));
    const res = await withAdvancingTimers(fetchWithTimeoutAndRetry("https://example.com", { retries: 1 }));
    expect(res.ok).toBe(false);
    expect(res.status).toBe(500);
  });
});
