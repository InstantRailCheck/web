import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatPhone(phone: string | null): string | null {
  if (!phone) return null;

  const digits = phone.replace(/\D/g, "");
  const tenDigits = digits.length === 11 && digits[0] === "1" ? digits.slice(1) : digits;

  if (tenDigits.length !== 10) return phone;

  return `(${tenDigits.slice(0, 3)}) ${tenDigits.slice(3, 6)}-${tenDigits.slice(6)}`;
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
