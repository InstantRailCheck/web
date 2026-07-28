import Link from "next/link";

const NAV_ITEMS = [
  { href: "/contribute", label: "Contribute" },
  { href: "/banks", label: "Browse all" },
  { href: "/timing", label: "Timing" },
  { href: "/rails", label: "Rail explorer" },
  { href: "/early-direct-deposit", label: "Early deposit" },
  { href: "/compare", label: "Compare" },
  { href: "/changelog", label: "Changelog" },
  { href: "/developers", label: "API" },
  { href: "/methodology", label: "Methodology" },
];

export function SiteNavLinks() {
  return (
    // On narrow viewports this row overflows and scrolls horizontally, but
    // nothing about a plain overflow-x-auto row signals that there's more
    // to see — most mobile browsers hide the scrollbar entirely, so links
    // past the fold (Changelog, API, Methodology) could go undiscovered.
    // The mask fades both edges toward transparent as a standard "there's
    // more this way" affordance; harmless when the row doesn't overflow
    // (it only clips a couple of already-padded pixels).
    <nav
      aria-label="Site navigation"
      className="no-scrollbar mx-auto flex w-fit min-w-0 max-w-[min(56rem,100%)] flex-nowrap gap-1.5 overflow-x-auto px-6 [mask-image:linear-gradient(to_right,transparent,black_16px,black_calc(100%-16px),transparent)]"
    >
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
