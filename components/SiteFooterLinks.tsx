import Link from "next/link";

export function SiteFooterLinks() {
  return (
    <p className="mx-auto mt-16 max-w-4xl px-6 text-center text-sm text-slate-500">
      <Link href="/banks" className="text-blue-400 hover:text-blue-300 transition">
        Browse all →
      </Link>
      {" · "}
      <Link href="/timing" className="text-blue-400 hover:text-blue-300 transition">
        Settlement time leaderboard →
      </Link>
      {" · "}
      <Link href="/rails" className="text-blue-400 hover:text-blue-300 transition">
        Rail explorer →
      </Link>
      {" · "}
      <Link href="/compare" className="text-blue-400 hover:text-blue-300 transition">
        Compare banks →
      </Link>
      {" · "}
      <Link href="/changelog" className="text-blue-400 hover:text-blue-300 transition">
        Changelog →
      </Link>
      {" · "}
      <Link href="/developers" className="text-blue-400 hover:text-blue-300 transition">
        API →
      </Link>
      {" · "}
      <Link href="/methodology" className="text-blue-400 hover:text-blue-300 transition">
        Methodology →
      </Link>
      {" · "}
      <Link href="/privacy" className="text-blue-400 hover:text-blue-300 transition">
        Privacy →
      </Link>
      {" · "}
      <Link href="/terms" className="text-blue-400 hover:text-blue-300 transition">
        Terms →
      </Link>
    </p>
  );
}
