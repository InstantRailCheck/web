import Link from "next/link";

const ENDPOINTS = [
  {
    method: "GET",
    path: "/api/banks",
    description: "List all banks. Optional ?q= to search by name. Add &format=csv for CSV instead of JSON.",
    example: "/api/banks?q=chase",
  },
  {
    method: "GET",
    path: "/api/banks/:id",
    description: "Full profile for one bank: contact info, network participation, and rail stats sending/receiving.",
    example: "/api/banks/c681154f-c3c4-4f50-9031-a05c79b2d152",
  },
  {
    method: "GET",
    path: "/api/routes",
    description: "Route intelligence between two banks. Requires ?from= and ?to= bank ids.",
    example: "/api/routes?from=<bank-id>&to=<bank-id>",
  },
  {
    method: "GET",
    path: "/api/changelog",
    description: "Recent activity feed — banks added and route reports submitted. Optional ?limit= (max 200, default 50). Add &format=csv for CSV instead of JSON.",
    example: "/api/changelog?limit=10",
  },
];

export default function DevelopersPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex w-full max-w-4xl flex-col px-6 pt-10 pb-16">
        <Link href="/" className="text-sm text-slate-400 hover:text-white transition">
          ← Back to search
        </Link>

        <h1 className="mt-4 text-3xl font-bold">API</h1>
        <p className="mt-1 text-sm text-slate-400">
          Read-only, unauthenticated, and CORS-enabled — free to use in your own tools.
          Responses are JSON by default; list endpoints also support <code>&amp;format=csv</code>.
        </p>

        <div className="mt-8 space-y-6">
          {ENDPOINTS.map((ep) => (
            <div key={ep.path} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
              <div className="flex items-center gap-3">
                <span className="rounded bg-green-500/10 px-2 py-0.5 text-xs font-semibold text-green-400">
                  {ep.method}
                </span>
                <code className="text-sm text-slate-100">{ep.path}</code>
              </div>
              <p className="mt-2 text-sm text-slate-400">{ep.description}</p>
              <code className="mt-3 block rounded-lg bg-slate-950 p-3 text-xs text-slate-500">
                GET https://www.instantrailcheck.com{ep.example}
              </code>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
