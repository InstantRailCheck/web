import Link from "next/link";
import { SiteNavLinks } from "@/components/SiteNavLinks";
import { RedditIcon } from "@/components/RedditIcon";

export function SiteFooterLinks() {
  return (
    <div className="mt-16">
      <SiteNavLinks />

      <p className="mx-auto mt-3 text-center text-sm text-slate-400">
        <a
          href="https://www.reddit.com/r/InstantRailCheck/"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-blue-400 hover:text-blue-300 transition"
        >
          <RedditIcon />
          Community on Reddit
        </a>
      </p>
      <p className="mx-auto mt-2 whitespace-nowrap px-6 text-center text-sm text-slate-400">
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
