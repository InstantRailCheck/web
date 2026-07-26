import Link from "next/link";
import { SiteNavLinks } from "@/components/SiteNavLinks";

export function SiteFooterLinks() {
  return (
    <div className="mt-16">
      <SiteNavLinks />

      <p className="mx-auto mt-3 whitespace-nowrap px-6 text-center text-sm text-slate-400">
        <Link href="/privacy" className="text-blue-400 hover:text-blue-300 transition">
          Privacy
        </Link>
        {" · "}
        <Link href="/terms" className="text-blue-400 hover:text-blue-300 transition">
          Terms
        </Link>
      </p>
    </div>
  );
}
