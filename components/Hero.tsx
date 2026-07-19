import Image from "next/image";
import Link from "next/link";
import { SiteNavLinks } from "@/components/SiteNavLinks";

export function Hero() {
  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col items-center px-6 pt-1 pb-2 text-center">
      <div className="mb-1 flex w-full justify-center">
        <Link href="/">
          <Image
            src="/logo-banner.png"
            alt="InstantRailCheck"
            width={1983}
            height={793}
            unoptimized
            priority
            className="block h-auto w-[640px] max-w-[90vw] md:w-[760px]"
          />
        </Link>
      </div>

      <div className="w-full min-w-0 flex flex-col items-center gap-3 font-sans">
        {/* Kept for accessibility/SEO (every page should have exactly one
            h1) — the logo image now carries this visually. */}
        <h1 className="sr-only">Verify before you transfer.</h1>

        {/* Full sentence doesn't fit on one line at any legible size below
            lg (section caps out at max-w-5xl, so wider screens don't buy
            more room) — swap in a shorter line on mobile instead of
            shrinking the text or letting it wrap. */}
        <p className="mt-1 m-0 hidden text-base leading-7 text-slate-300 lg:block lg:whitespace-nowrap">
          Check RTP, FedNow, ACH, wire, and other bank transfer compatibility between U.S.
          financial institutions.
        </p>
        <p className="mt-1 m-0 text-base leading-7 text-slate-300 lg:hidden">
          Check RTP, FedNow, ACH &amp; wire compatibility.
        </p>

        <div className="mt-2 w-full min-w-0">
          <SiteNavLinks />
        </div>

        <div className="mt-3 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a
            href="#search"
            className="rounded-full bg-cyan-400 px-6 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-cyan-400/20 transition hover:bg-cyan-300"
          >
            Start searching
          </a>

          <a
            href="#how-it-works"
            className="rounded-full border border-slate-600 px-6 py-3 text-sm font-semibold text-white transition hover:border-cyan-300 hover:text-cyan-300"
          >
            How it works
          </a>
        </div>
      </div>
    </section>
  );
}