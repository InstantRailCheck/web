// Shared by fdicLookup.ts and finraLookup.ts (ncuaLookup.ts queries the
// locally-synced ncua_credit_unions table instead of a live external API,
// so it doesn't need this). Both run synchronously inside enrichBank()/
// submitCorrection() request paths — an unbounded fetch() to a slow or
// hanging government API could otherwise tie up the whole request
// indefinitely instead of failing fast with a clear result.
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_RETRIES = 1;
const RETRY_BACKOFF_MS = 300;

export async function fetchWithTimeoutAndRetry(
  url: string,
  options: { timeoutMs?: number; retries?: number } = {}
): Promise<Response | null> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, retries = DEFAULT_RETRIES } = options;

  let lastResponse: Response | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) return res;
      lastResponse = res; // non-2xx — worth one retry in case it was transient
    } catch {
      lastResponse = null; // timed out or a network-level failure
    }

    if (attempt < retries) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_BACKOFF_MS * (attempt + 1)));
    }
  }
  return lastResponse;
}
