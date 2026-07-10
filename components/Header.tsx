"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SiteNavLinks } from "@/components/SiteNavLinks";

// Terms/privacy keep the traditional bottom-of-page footer (SiteFooterLinks)
// instead of this top nav — legal pages read better without nav chrome
// competing for attention above the fold.
const NO_TOP_NAV_PATHS = new Set(["/terms", "/privacy"]);

export function Header() {
  const pathname = usePathname();
  if (pathname === "/") return null;

  return (
    <header className="flex w-full flex-col items-center gap-4 px-6 py-4">
      <Link href="/" className="inline-flex items-center">
        <img
          src="/logo.png"
          alt="InstantRailCheck"
          width={680}
          height={153}
          className="h-16 w-auto"
        />
      </Link>
      {!NO_TOP_NAV_PATHS.has(pathname) && <SiteNavLinks />}
    </header>
  );
}
