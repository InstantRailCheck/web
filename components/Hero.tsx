import Link from "next/link";

export function Hero() {
  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col items-center px-6 pt-1 pb-2 text-center">
      <div className="mb-1 flex w-full justify-center">
        <Link href="/">
          <img
            src="/logo.png"
            alt="InstantRailCheck"
            width={680}
            height={153}
            className="block h-auto w-[520px] max-w-[90vw] md:w-[560px]"
          />
        </Link>
      </div>

      <div className="flex flex-col items-center gap-3 font-sans">
        <h1 className="m-0 max-w-5xl text-5xl font-extrabold leading-[0.95] tracking-tight text-white md:text-7xl">
          Know before you transfer.
        </h1>

        <p className="mt-1 m-0 text-balance text-base leading-7 text-slate-300 lg:whitespace-nowrap">
          Check RTP, FedNow, ACH, wire, and other bank transfer compatibility between U.S.
          financial institutions.
        </p>

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