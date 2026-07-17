import { slugify, uniqueSlug } from "@/lib/slugify";

// v8.0 §9: a bare slugify(name) collision used to fall through straight to
// uniqueSlug's numeric suffix (pinnacle-bank-2, pinnacle-bank-3, ...) —
// correct, but meaningless to a reader and unstable if institutions are
// ever processed in a different order. A duplicate-name group deserves a
// readable, deterministic disambiguator instead: state + the institution's
// own regulator identifier, which is stable per-charter forever. The
// numeric suffix remains the final safety net for the (expected to be
// rare) case where even that collides.
export function institutionSlug(
  name: string,
  state: string | null,
  identifier: number,
  usedSlugs: Set<string>
): string {
  const base = slugify(name);
  if (!usedSlugs.has(base)) return base;

  if (state) {
    const withState = `${base}-${slugify(state)}-${identifier}`;
    if (!usedSlugs.has(withState)) return withState;
  } else {
    const withIdentifier = `${base}-${identifier}`;
    if (!usedSlugs.has(withIdentifier)) return withIdentifier;
  }

  return uniqueSlug(base, usedSlugs);
}
