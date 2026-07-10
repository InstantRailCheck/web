import Link from "next/link";

export function LegalFooterLinks() {
  return (
    <div className="mt-16">
      <p className="mx-auto whitespace-nowrap px-6 text-center text-sm text-slate-500">
        <Link href="/privacy" className="text-blue-400 hover:text-blue-300 transition">
          Privacy
        </Link>
        {" · "}
        <Link href="/terms" className="text-blue-400 hover:text-blue-300 transition">
          Terms
        </Link>
      </p>
    </div>
  );
}
