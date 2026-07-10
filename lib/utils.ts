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

// Re-exported from lib/slugify.ts, which has zero dependencies so the
// plain Node scripts (backfill-bank-slugs.mjs, the bulk import scripts)
// can import it directly without pulling in clsx/tailwind-merge.
export { slugify } from "@/lib/slugify";
