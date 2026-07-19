import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

function normalizePhoneDigits(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  const tenDigits = digits.length === 11 && digits[0] === "1" ? digits.slice(1) : digits;
  return tenDigits.length === 10 ? tenDigits : null;
}

export function formatPhone(phone: string | null): string | null {
  if (!phone) return null;

  const tenDigits = normalizePhoneDigits(phone);
  if (!tenDigits) return phone;

  return `(${tenDigits.slice(0, 3)}) ${tenDigits.slice(3, 6)}-${tenDigits.slice(6)}`;
}

// All bank phone numbers in the data are US numbers, so +1 is safe to assume
// here even though formatPhone falls back to displaying the raw string for
// anything that isn't a clean 10/11-digit number.
export function telHref(phone: string | null): string | null {
  if (!phone) return null;

  const tenDigits = normalizePhoneDigits(phone);
  return tenDigits ? `tel:+1${tenDigits}` : null;
}

// FDIC-sourced banks.website values are stored as a bare domain with no
// protocol (e.g. "ozk.com") - a browser resolves that as a RELATIVE link
// against the current page, not an external site, so every FDIC bank's
// website link silently 404'd back onto this site's own domain
// (confirmed live: /banks/bank-ozk's website link pointed at
// instantrailcheck.com/banks/ozk.com). NCUA-sourced values already
// include a protocol. This is the belt to the sync pipeline's
// suspenders - guarantees a working absolute link regardless of which
// shape is actually stored, present data included.
export function websiteHref(website: string | null): string | null {
  if (!website) return null;
  return /^https?:\/\//i.test(website) ? website : `https://${website}`;
}

// Strips everything but letters/digits so punctuation differences don't
// break substring search — "US Bank" needs to find "U.S. Bank National
// Association", which a plain ILIKE '%US Bank%' never will since the
// periods break the literal substring. Must match banks.name_normalized
// (a generated column using the same regexp) for search queries to work.
export function normalizeForSearch(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Re-exported from lib/slugify.ts, which has zero dependencies so the
// plain Node scripts (backfill-bank-slugs.mjs, the bulk import scripts)
// can import it directly without pulling in clsx/tailwind-merge.
export { slugify } from "@/lib/slugify";
