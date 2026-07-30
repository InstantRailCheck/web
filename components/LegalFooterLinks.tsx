import Link from "next/link";
import { RedditIcon } from "@/components/RedditIcon";

export function LegalFooterLinks() {
  return (
    <div className="mt-16">
      <p className="mx-auto text-center text-sm text-slate-400">
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
