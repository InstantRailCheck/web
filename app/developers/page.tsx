import Link from "next/link";
import { API_URL } from "@/lib/siteConfig";
import { LegalFooterLinks } from "@/components/LegalFooterLinks";

export const dynamic = "force-dynamic";

const ENDPOINTS = [
  {
    method: "GET",
    path: "/banks",
    description: "List all banks. Optional ?q= to search by name. Add &format=csv for CSV instead of JSON.",
    example: "/banks?q=chase",
  },
  {
    method: "GET",
    path: "/banks/:id",
    description: "Full profile for one bank: contact info, network participation, and rail stats sending/receiving.",
    example: "/banks/c681154f-c3c4-4f50-9031-a05c79b2d152",
  },
  {
    method: "GET",
    path: "/routes",
    description: "Route intelligence between two banks. Requires ?from= and ?to= bank ids.",
    example: "/routes?from=<bank-id>&to=<bank-id>",
  },
  {
    method: "GET",
    path: "/changelog",
    description: "Recent activity feed — banks added and route reports submitted. Optional ?limit= (max 200, default 50). Add &format=csv for CSV instead of JSON.",
    example: "/changelog?limit=10",
  },
];

export default function DevelopersPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex w-full max-w-4xl flex-col px-6 pt-10 pb-16">
        <h1 className="text-center text-3xl font-bold">API</h1>
        <p className="mt-1 text-center text-sm text-slate-400">
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
                GET {API_URL}{ep.example}
              </code>
            </div>
          ))}
        </div>

        <div className="mt-10 rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <h2 className="text-lg font-semibold">Webhooks</h2>
          <p className="mt-2 text-sm text-slate-400">
            Rather than polling <code>{API_URL}/changelog</code>, register a URL at{" "}
            <Link href="/webhooks" className="text-blue-400 hover:text-blue-300 transition">
              /webhooks
            </Link>{" "}
            (requires signing in) to get a signed POST whenever a new bank is added. Each
            delivery includes an <code>X-InstantRailCheck-Signature</code> header — HMAC-SHA256
            of the raw request body using the secret shown when you register. Deliveries are
            fire-and-forget with no retry, so your endpoint should respond quickly with a 2xx.
          </p>
        </div>

        <LegalFooterLinks />
      </div>
    </main>
  );
}
