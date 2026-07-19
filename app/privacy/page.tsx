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
              <h2 className="text-lg font-semibold text-white">Information we collect</h2>
              <p className="mt-2">
                If you create an account, we store your email address and any passkeys you
                register. For passkeys, Supabase stores the public credential and basic
                management metadata, such as a label and creation/last-used timestamps; your
                fingerprint, face, or device PIN never leaves your device.
              </p>
              <p className="mt-2">
                We store information you submit, including route and early-deposit reports, route
                requests, bank corrections, notes, and webhook settings. Submissions are privately
                linked to your account while it exists.
              </p>
              <p className="mt-2">
                We also temporarily process your IP address in short-lived rate-limit records for
                security and abuse prevention. Vercel provides cookie-free, aggregate site
                analytics.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-white">How we use and share information</h2>
              <p className="mt-2">
                We use this information to operate InstantRailCheck, publish community-supplied
                banking information, deliver requested features, and detect spam or fabricated
                reports.
              </p>
              <p className="mt-2">
                Supabase processes authentication and database information, Vercel provides
                hosting and analytics, and Google or GitHub processes information if you choose
                the corresponding sign-in option.
              </p>
              <p className="mt-2">
                We do not sell personal information, run advertising, or track you across other
                websites.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-white">Moderation and deletion</h2>
              <p className="mt-2">
                Administrators may remove submissions, restrict an account from submitting, or —
                for serious or repeated abuse — temporarily or permanently suspend an account, to
                address spam, fabrication, duplication, privacy concerns, or other data-quality
                problems. We retain a private moderation record containing the reason and limited
                information about the action so we can identify repeated abuse while an account
                exists.
              </p>
              <p className="mt-2">
                You can delete your account from{" "}
                <Link href="/account" className="text-blue-400 hover:text-blue-300 transition">
                  /account
                </Link>
                . This immediately removes your sign-in credentials, passkeys, and webhooks. Your
                community submissions remain as anonymous data, with their connection to you
                removed. Minimal moderation facts and reasons may remain without your identity.
                To have your anonymous submissions removed entirely, contact us below.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-white">Contact</h2>
              <p className="mt-2">
                Privacy questions or removal requests:{" "}
                <a href="mailto:privacy@instantrailcheck.com" className="text-blue-400 hover:text-blue-300 transition">
                  privacy@instantrailcheck.com
                </a>
                . Security reports:{" "}
                <a href="mailto:security@instantrailcheck.com" className="text-blue-400 hover:text-blue-300 transition">
                  security@instantrailcheck.com
                </a>
                .
              </p>
            </section>
          </div>
        </div>

        <SiteFooterLinks />
      </div>
    </main>
  );
}
