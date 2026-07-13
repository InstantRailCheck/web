"use client";

import { useEffect } from "react";

export default function NeedsFreshReportsError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
      <div className="mx-auto flex w-full max-w-md flex-col items-center px-6 text-center">
        <h1 className="text-2xl font-bold">Something went wrong</h1>
        <p className="mt-2 text-sm text-slate-400">Couldn&apos;t load this list right now. Please try again.</p>
        <button
          type="button"
          onClick={() => unstable_retry()}
          className="mt-6 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
