import Link from "next/link";

export function Header() {
  return (
    <header className="w-full px-6 py-4">
      <Link href="/" className="inline-flex items-center">
        <img
          src="/logo.png"
          alt="InstantRailCheck"
          width={680}
          height={153}
          className="h-8 w-auto"
        />
      </Link>
    </header>
  );
}
