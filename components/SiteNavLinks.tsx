import Link from "next/link";

const NAV_ITEMS = [
  { href: "/banks", label: "Browse all" },
  { href: "/timing", label: "Settlement time leaderboard" },
  { href: "/rails", label: "Rail explorer" },
  { href: "/compare", label: "Compare banks" },
  { href: "/changelog", label: "Changelog" },
  { href: "/developers", label: "API" },
  { href: "/methodology", label: "Methodology" },
];

export function SiteNavLinks() {
  return (
    <nav className="mx-auto flex max-w-4xl flex-wrap justify-center gap-2 px-6">
      {NAV_ITEMS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="rounded-full border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-cyan-300 hover:text-cyan-300 sm:text-sm"
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
