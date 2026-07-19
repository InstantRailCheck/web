import Image from "next/image";

export default function MaintenancePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-6 text-center text-white">
      <Image
        src="/logo-banner.png"
        alt="InstantRailCheck"
        width={1983}
        height={793}
        unoptimized
        className="mb-8 h-16 w-auto"
      />
      <h1 className="text-3xl font-bold">We&apos;ll be right back.</h1>
      <p className="mt-4 max-w-md text-slate-400">
        InstantRailCheck is undergoing maintenance. Check back soon.
      </p>
    </main>
  );
}
