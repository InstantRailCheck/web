"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function Header() {
  const pathname = usePathname();
  if (pathname === "/") return null;

  return (
    <header className="flex w-full justify-center px-6 py-4">
      <Link href="/" className="inline-flex items-center">
        <img
          src="/logo.png"
          alt="InstantRailCheck"
          width={680}
          height={153}
          className="h-16 w-auto"
        />
      </Link>
    </header>
  );
}
