import Link from "next/link";

const NAV_ITEMS = [
  { href: "/#search", label: "Submit report" },
  { href: "/banks", label: "Browse all" },
  { href: "/timing", label: "Timing" },
  { href: "/rails", label: "Rail explorer" },
  { href: "/compare", label: "Compare" },
  { href: "/changelog", label: "Changelog" },
  { href: "/developers", label: "API" },
  { href: "/methodology", label: "Methodology" },
];

export function SiteNavLinks() {
  return (
    <nav className="mx-auto flex w-fit min-w-0 max-w-[min(56rem,100%)] flex-nowrap gap-1.5 overflow-x-auto px-6">
      {NAV_ITEMS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="shrink-0 rounded-full border border-slate-700 px-2.5 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-cyan-300 hover:text-cyan-300 sm:px-3 sm:text-sm"
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
