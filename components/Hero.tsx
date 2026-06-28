import Image from "next/image";

export function Hero() {
  return (
    <div className="flex flex-col items-center">
      <Image
        src="/logo.png"
        alt="InstantRailCheck"
        width={420}
        height={120}
        priority
      />

      <h1 className="mb-4 mt-6 text-5xl font-bold tracking-tight md:text-6xl">
        Know before you transfer.
      </h1>

      <p className="mx-auto mb-10 max-w-2xl text-lg text-slate-300 text-center">
        Search real-world bank transfer compatibility across RTP, FedNow, ACH,
        wire, and more.
      </p>
    </div>
  );
}