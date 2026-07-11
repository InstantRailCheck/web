import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchWithTimeoutAndRetry } from "./externalFetch";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

beforeEach(() => {
  fetchMock.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// Backoff delays use real setTimeout — under fake timers that never
// resolves on its own, so advance the clock alongside awaiting the call.
async function withAdvancingTimers<T>(promise: Promise<T>): Promise<T> {
  const done = promise;
  await vi.advanceTimersByTimeAsync(10_000);
  return done;
}

function okResponse() {
  return { ok: true, status: 200 } as Response;
}
function errorResponse(status: number) {
  return { ok: false, status } as Response;
}

describe("fetchWithTimeoutAndRetry", () => {
  it("returns the response immediately on a successful first attempt", async () => {
    fetchMock.mockResolvedValueOnce(okResponse());
    const res = await fetchWithTimeoutAndRetry("https://example.com", { retries: 1 });
    expect(res?.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("passes an AbortSignal derived from timeoutMs to fetch", async () => {
    fetchMock.mockResolvedValueOnce(okResponse());
    await fetchWithTimeoutAndRetry("https://example.com", { timeoutMs: 1234 });
    const [, options] = fetchMock.mock.calls[0];
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("retries once on a network-level failure and succeeds on the second attempt", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down")).mockResolvedValueOnce(okResponse());
    const res = await withAdvancingTimers(fetchWithTimeoutAndRetry("https://example.com", { retries: 1 }));
    expect(res?.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries on a non-2xx response and succeeds on the second attempt", async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(503)).mockResolvedValueOnce(okResponse());
    const res = await withAdvancingTimers(fetchWithTimeoutAndRetry("https://example.com", { retries: 1 }));
    expect(res?.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns the last non-ok response after exhausting retries (caller decides how to handle it)", async () => {
    fetchMock.mockResolvedValue(errorResponse(500));
    const res = await withAdvancingTimers(fetchWithTimeoutAndRetry("https://example.com", { retries: 1 }));
    expect(res?.ok).toBe(false);
    expect(res?.status).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns null after every attempt throws a network error", async () => {
    fetchMock.mockRejectedValue(new Error("still down"));
    const res = await withAdvancingTimers(fetchWithTimeoutAndRetry("https://example.com", { retries: 1 }));
    expect(res).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("makes exactly retries+1 attempts total", async () => {
    fetchMock.mockRejectedValue(new Error("down"));
    await withAdvancingTimers(fetchWithTimeoutAndRetry("https://example.com", { retries: 3 }));
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("makes only one attempt when retries is 0", async () => {
    fetchMock.mockRejectedValue(new Error("down"));
    const res = await fetchWithTimeoutAndRetry("https://example.com", { retries: 0 });
    expect(res).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
