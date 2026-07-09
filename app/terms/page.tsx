import Link from "next/link";
import { SiteFooterLinks } from "@/components/SiteFooterLinks";

export const dynamic = "force-static";

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex w-full max-w-3xl flex-col px-6 pt-10 pb-16">
        <h1 className="text-center text-3xl font-bold">Terms of Service</h1>
        <p className="mt-1 text-center text-sm text-slate-500">Last updated July 8, 2026.</p>

        <div className="mt-8 space-y-8 text-sm leading-relaxed text-slate-300">
          <section>
            <h2 className="text-lg font-semibold text-white">What this is</h2>
            <p className="mt-2">
              InstantRailCheck is a free, crowdsourced database of real-world bank transfer
              compatibility — which payment rails (RTP, FedNow, ACH, Wire, Zelle, and others)
              actually work between which banks. It's provided as-is, free of charge.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">Accuracy isn't guaranteed</h2>
            <p className="mt-2">
              Data comes from a mix of official sources (FDIC, NCUA, FinRA, the Fed, The
              Clearing House) and user-submitted reports. We work to keep it accurate — unknown
              is always shown as unknown rather than guessed — but rail availability changes,
              and we make no guarantee any specific route will work as shown. Always confirm
              with your bank before relying on a transfer method for anything time-sensitive or
              high-value.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">Your account and submissions</h2>
            <p className="mt-2">
              Signing in requires a real email address (via Google or a one-time code) or a
              passkey tied to a real account — no anonymous submissions. Route reports should
              reflect actual transfers you've made or observed. Submitting false or intentionally
              misleading reports may result in account suspension.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">API and webhooks</h2>
            <p className="mt-2">
              The public API and webhooks (documented at{" "}
              <Link href="/developers" className="text-blue-400 hover:text-blue-300 transition">
                /developers
              </Link>
              ) are free to use, rate-limited per IP, and provided without uptime guarantees.
              Webhook deliveries are fire-and-forget with no retry — your endpoint is responsible
              for its own reliability.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">No warranty</h2>
            <p className="mt-2">
              InstantRailCheck is provided "as is," without warranty of any kind. We're not
              liable for any loss, delay, or damage resulting from reliance on data shown on this
              site or returned by the API.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">Changes</h2>
            <p className="mt-2">
              These terms may be updated as the service evolves. Continued use after a change
              means you accept the updated terms.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">Contact</h2>
            <p className="mt-2">
              Questions: <span className="text-slate-100">security@instantrailcheck.com</span>
            </p>
          </section>
        </div>

        <SiteFooterLinks />
      </div>
    </main>
  );
}
