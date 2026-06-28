export function Hero() {
  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col items-center px-6 pt-6 pb-8 text-center">
      <div className="mb-3 flex w-full justify-center">
        <img
          src="/logo.png"
          alt="InstantRailCheck"
          width={680}
          height={153}
          className="block h-auto w-[580px] max-w-[94vw] md:w-[680px]"
        />
      </div>

      <div className="flex flex-col items-center gap-5 font-sans">
        <h1 className="m-0 max-w-5xl text-5xl font-extrabold leading-[0.95] tracking-tight text-white md:text-7xl">
          Know before you transfer.
        </h1>

        <p className="m-0 max-w-3xl text-base leading-7 text-slate-300 md:text-lg">
          Search real-world bank transfer compatibility across RTP, FedNow, ACH,
          wire, and more.
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