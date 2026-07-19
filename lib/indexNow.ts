// Notifies IndexNow-participating search engines (Bing, Yandex, and others)
// that specific URLs changed, instead of waiting on their own crawl
// schedule. Dependency-light on purpose — only a relative import of
// ./siteConfig.ts, no "@/" alias, no server-only — so it's safely
// importable from both Next.js Server Actions and the plain
// scripts/sync-institution-directory.mjs script via Node's native
// TypeScript stripping, same reasoning as lib/institutionSlug.ts's own
// relative import of ./slugify.ts.
import { SITE_URL } from "./siteConfig.ts";

// Must exactly match the filename (minus extension) of the key file
// published at public/<INDEXNOW_KEY>.txt, whose content is this same
// string — IndexNow verifies ownership by fetching keyLocation and
// checking it equals key. Checked against the real file in
// indexNow.test.ts so the two can never silently drift apart.
export const INDEXNOW_KEY = "f285701b97c54bf0850ab2c205c02daa";

const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
const SUBMIT_TIMEOUT_MS = 5000;

// IndexNow's endpoint is a fixed, trusted third-party host, not a
// user-controlled URL — none of triggerWebhooks.ts's SSRF/DNS-pinning
// machinery applies here, so this uses plain global fetch. Never throws:
// every caller fires this and forgets, exactly like triggerWebhooks().
export async function submitUrlsToIndexNow(urls: string[]): Promise<void> {
  if (urls.length === 0) return;

  const host = new URL(SITE_URL).host;

  try {
    const res = await fetch(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        host,
        key: INDEXNOW_KEY,
        keyLocation: `${SITE_URL}/${INDEXNOW_KEY}.txt`,
        urlList: urls,
      }),
      signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
    });

    if (!res.ok) {
      console.error(JSON.stringify({ level: "error", message: "IndexNow submission returned a non-2xx status", status: res.status, urlCount: urls.length }));
    }
  } catch (err) {
    console.error(JSON.stringify({ level: "error", message: "IndexNow submission failed", error: err instanceof Error ? err.message : String(err), urlCount: urls.length }));
  }
}
