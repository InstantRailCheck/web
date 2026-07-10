export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Given a base slug and the set of slugs already in use, returns a
// guaranteed-unique slug — the base itself if free, otherwise base-2,
// base-3, etc. Shared by every place that assigns a new bank a slug
// (addBank.ts, backfill-bank-slugs.mjs, and the two bulk import scripts)
// so the collision-suffix convention only needs to be correct in one place.
export function uniqueSlug(base: string, usedSlugs: Set<string>): string {
  let slug = base;
  let suffix = 2;
  while (usedSlugs.has(slug)) {
    slug = `${base}-${suffix}`;
    suffix++;
  }
  return slug;
}
