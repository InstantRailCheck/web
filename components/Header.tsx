"use client";

import Image from "next/image";
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
        <Image
          src="/logo-banner.png"
          alt="InstantRailCheck"
          width={1072}
          height={128}
          unoptimized
          className="h-auto w-[1072px] max-w-full"
        />
      </Link>
      {!NO_TOP_NAV_PATHS.has(pathname) && <SiteNavLinks />}
    </header>
  );
}
