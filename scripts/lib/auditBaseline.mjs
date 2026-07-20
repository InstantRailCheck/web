// Shared by audit-duplicate-institutions.mjs and
// audit-duplicate-name-rail-flags.mjs so a scheduled CI run can distinguish
// "already known, reviewed, and accepted as unresolved for now" from
// "genuinely new since the last time someone looked" — without that, every
// run keeps re-flagging the same long-lived ambiguous backlog (e.g. six
// distinct Pinnacle Bank charters sharing a name) forever, which trains
// whoever's watching CI to ignore the signal entirely.
//
// Baseline files store only a bare list of stable keys (bank slugs, or
// "slug:rail" pairs) — never names/addresses/assets — since those files are
// committed to the repo, and this project's convention (ADR-0006 §12) is to
// never commit real institution detail, only short-retention CI artifacts.
import { readFile, writeFile } from "node:fs/promises";

export async function loadBaselineKeys(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    return new Set(JSON.parse(raw));
  } catch (err) {
    if (err.code === "ENOENT") return new Set();
    throw err;
  }
}

export async function saveBaselineKeys(filePath, keys) {
  const sorted = Array.from(new Set(keys)).sort();
  await writeFile(filePath, JSON.stringify(sorted, null, 2) + "\n");
}

// Splits `items` into { news, known } by whether keyFn(item) is present in
// baselineKeys. Order of `items` is preserved within each output array.
export function partitionByBaseline(items, keyFn, baselineKeys) {
  const news = [];
  const known = [];
  for (const item of items) {
    (baselineKeys.has(keyFn(item)) ? known : news).push(item);
  }
  return { news, known };
}
