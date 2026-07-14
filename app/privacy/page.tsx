import Link from "next/link";
import { SiteFooterLinks } from "@/components/SiteFooterLinks";

export const dynamic = "force-static";

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex w-full max-w-4xl flex-col px-6 pt-10 pb-16">
        <div className="mx-auto w-full max-w-3xl">
          <h1 className="text-center text-3xl font-bold">Privacy Policy</h1>
          <p className="mt-1 text-center text-sm text-slate-500">Last updated July 14, 2026.</p>

          <div className="mt-8 space-y-8 text-sm leading-relaxed text-slate-300">
            <section>
              <h2 className="text-lg font-semibold text-white">What we collect</h2>
              <p className="mt-2">
                If you sign in, we store your email address (via magic link/one-time code or
                Google sign-in) and, if you choose to add one, a passkey — only the public key
                InstantRailCheck.com is stored on our servers; your device&apos;s fingerprint, face, or
                screen lock never leaves your device.
              </p>
              <p className="mt-2">
                If you submit a route report or register a webhook, we store what you enter: the
                banks involved, the rail used, the outcome, and any notes you add, associated with
                your account. If you request a route (asking that someone check a transfer we
                don&apos;t yet have evidence for), we store only the two banks involved — no rail,
                outcome, or notes, since a request isn&apos;t a report.
              </p>
              <p className="mt-2">
                Bank and credit union directory data (names, websites, addresses, network
                participation) is public institutional information sourced from official
                regulators — it is not personal data about you.
              </p>
              <p className="mt-2">
                Submissions may also be removed by an administrator — for spam, fabrication,
                duplication, a privacy request, or other data-quality reasons. This is separate
                from the account-initiated anonymization described below: a removal takes the
                submission down entirely. We keep a private internal record of each removal (the
                reason given and a minimal snapshot of what was removed) for accountability. While
                your account exists, that record — and your submissions generally — stay privately
                linked to it (never shown publicly) specifically so we can detect abuse patterns,
                such as repeated spam or fabricated reports from the same account. That may result
                in a submission being removed, your account being restricted from submitting, or
                (for serious or repeated abuse) your account being temporarily or permanently
                suspended. The identity link is removed when your account is deleted, whether you
                delete it yourself or we do as part of addressing abuse — what remains afterward is
                the bare fact that some action was taken and why, not who it was taken against.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-white">What we don&apos;t do</h2>
              <p className="mt-2">
                We don&apos;t sell your data, run ads, or track you across other sites. Our analytics
                (Vercel Web Analytics) is cookie-free and reports aggregate usage only — it doesn&apos;t
                identify individual visitors.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-white">Who we share it with</h2>
              <p className="mt-2">
                InstantRailCheck runs on Supabase (authentication and database), Vercel (hosting
                and analytics), and Google (if you choose to sign in with Google). Each processes
                data only as needed to run the service — we don&apos;t sell or otherwise share your
                data with anyone else.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-white">Your data, your account</h2>
              <p className="mt-2">
                You can delete your registered passkeys and webhooks at any time from{" "}
                <Link href="/account" className="text-blue-400 hover:text-blue-300 transition">
                  /account
                </Link>{" "}
                and{" "}
                <Link href="/webhooks" className="text-blue-400 hover:text-blue-300 transition">
                  /webhooks
                </Link>
                . You can also delete your account entirely from{" "}
                <Link href="/account" className="text-blue-400 hover:text-blue-300 transition">
                  /account
                </Link>
                , which removes your sign-in, passkeys, and webhooks immediately. Route reports,
                EDD reports, corrections, and route requests you&apos;ve submitted remain as
                anonymous community data rather than being deleted outright, since other
                people&apos;s view of a bank or route may depend on them — they&apos;re no longer
                linked to you in any way once your account is deleted. If you&apos;d like those
                removed entirely instead of anonymized, contact us below and we&apos;ll remove them
                through our moderation process.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-white">Contact</h2>
              <p className="mt-2">
                Questions about this policy: <span className="text-slate-100">security@instantrailcheck.com</span>
              </p>
            </section>
          </div>
        </div>

        <SiteFooterLinks />
      </div>
    </main>
  );
}
