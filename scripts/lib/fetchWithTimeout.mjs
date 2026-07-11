// Scripts run as plain Node (no TS transpilation step in the workflow), so
// this mirrors lib/externalFetch.ts rather than importing it directly.
// Applied to the two scheduled syncs that had no timeout/retry protection
// at all (sync-rail-participants.mjs, sync-zelle-participants.mjs) —
// sync-ncua-directory.mjs already has its own tailored retry helper for a
// specific, previously-observed ncua.gov flakiness pattern and is left as is.
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_RETRIES = 2;
const RETRY_BACKOFF_MS = 1000;

export async function fetchWithTimeoutAndRetry(url, options = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, retries = DEFAULT_RETRIES } = options;

  let lastResponse = null;
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) return res;
      lastResponse = res;
      lastError = null;
    } catch (err) {
      lastResponse = null;
      lastError = err;
    }

    if (attempt < retries) {
      const delayMs = RETRY_BACKOFF_MS * 2 ** attempt;
      console.log(`  fetch ${url} failed (${lastError?.message ?? `HTTP ${lastResponse?.status}`}), retrying in ${delayMs}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  if (lastError) throw lastError;
  return lastResponse;
}
