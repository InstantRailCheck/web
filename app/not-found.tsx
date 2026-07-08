import Link from "next/link";

export const dynamic = "force-dynamic";

export default function NotFound() {
  return (
    <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
      <div className="mx-auto flex w-full max-w-md flex-col items-center px-6 text-center">
        <h1 className="text-3xl font-bold">Page not found</h1>
        <p className="mt-2 text-sm text-slate-400">
          The page you're looking for doesn't exist.
        </p>
        <Link
          href="/"
          className="mt-6 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500"
        >
          Back to search
        </Link>
      </div>
    </main>
  );
}
