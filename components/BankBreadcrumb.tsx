import Link from "next/link";

export function BankBreadcrumb({ bankName }: { bankName: string }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-4 text-center text-sm text-slate-500">
      <ol className="inline-flex items-center gap-2">
        <li>
          <Link href="/banks" className="hover:text-slate-300 transition">
            All banks
          </Link>
        </li>
        <li aria-hidden="true">/</li>
        <li aria-current="page" className="text-slate-300">
          {bankName}
        </li>
      </ol>
    </nav>
  );
}
