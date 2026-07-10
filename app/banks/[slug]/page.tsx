import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound, permanentRedirect } from "next/navigation";
import { Banknote, CalendarCheck, Clock, Landmark, Zap } from "lucide-react";
import { getBankProfileBySlug, getBankSlugById, type RailEvidence, type EddEvidence } from "@/lib/bankProfile";
import { formatPhone } from "@/lib/utils";
import { SuggestCorrection } from "@/components/SuggestCorrection";
import { SubmitEddReport } from "@/components/SubmitEddReport";
import { SiteFooterLinks } from "@/components/SiteFooterLinks";
import { SITE_URL } from "@/lib/siteConfig";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RAIL_STYLES: Record<string, { border: string; bg: string; text: string }> = {
  RTP: { border: "border-green-500/30", bg: "bg-green-500/10", text: "text-green-300" },
  FedNow: { border: "border-purple-500/30", bg: "bg-purple-500/10", text: "text-purple-300" },
  ACH: { border: "border-blue-500/30", bg: "bg-blue-500/10", text: "text-blue-300" },
  Wire: { border: "border-slate-800", bg: "bg-slate-900", text: "text-slate-300" },
  Zelle: { border: "border-violet-500/30", bg: "bg-violet-500/10", text: "text-violet-300" },
  "Visa Direct": { border: "border-sky-500/30", bg: "bg-sky-500/10", text: "text-sky-300" },
  "Mastercard Send": { border: "border-orange-500/30", bg: "bg-orange-500/10", text: "text-orange-300" },
};

function getRailStyle(rail: string) {
  return RAIL_STYLES[rail] ?? { border: "border-slate-700", bg: "bg-slate-900", text: "text-slate-300" };
}

function RailList({ rails }: { rails: Awaited<ReturnType<typeof getBankProfileBySlug>>["sending"] }) {
  if (rails.length === 0) {
    return <p className="text-sm text-slate-500">No reports yet.</p>;
  }

  return (
    <div className="flex flex-wrap justify-center gap-3">
      {rails.map((rail) => {
        const s = getRailStyle(rail.rail);
        return (
          <div
            key={rail.rail}
            className={`w-full rounded-lg border ${s.border} ${s.bg} p-3 text-sm ${s.text} sm:w-[calc(50%-0.375rem)]`}
          >
            <div>
              {rail.rail}: {Math.round(rail.successRate * 100)}% success
              {rail.avgTime !== null && ` · ~${rail.avgTime}m avg`}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-2 text-xs opacity-70">
              {rail.isStale && <span className="text-yellow-400">⚠ Stale</span>}
              {!!rail.sameDayCount && (
                <span>
                  Same-Day ACH in {rail.sameDayCount} report{rail.sameDayCount !== 1 ? "s" : ""}
                </span>
              )}
              {rail.lastTested && <span>Last tested {rail.lastTested}</span>}
              <span>{rail.count} report{rail.count !== 1 ? "s" : ""}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RailEvidenceCard({
  icon,
  label,
  border,
  bg,
  text,
  evidence,
  footnote,
}: {
  icon: React.ReactNode;
  label: string;
  border: string;
  bg: string;
  text: string;
  evidence: RailEvidence;
  footnote?: string;
}) {
  return (
    <div className={`w-full rounded-xl border ${border} ${bg} p-4 text-sm sm:w-[calc(33.333%-0.5rem)]`}>
      <div className={`flex items-center gap-2 font-semibold ${text}`}>
        {icon} {label} participant
      </div>
      {evidence.confirmedAt && (
        <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-slate-950/40 px-2.5 py-1.5 text-xs font-medium text-slate-200">
          <CalendarCheck className="h-3.5 w-3.5 shrink-0" />
          Confirmed{" "}
          {new Date(evidence.confirmedAt).toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </div>
      )}
      <dl className="mt-3 space-y-2 text-xs">
        <div>
          <dt className="text-slate-500">Source</dt>
          <dd className="text-slate-300">
            {evidence.sourceUrl ? (
              <a
                href={evidence.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-slate-600 underline-offset-2 hover:text-white hover:decoration-slate-400 transition"
              >
                {evidence.source}
              </a>
            ) : (
              evidence.source
            )}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Community confirmations</dt>
          <dd className="text-slate-300">{evidence.communityConfirmations}</dd>
        </div>
      </dl>
      {footnote && <p className="mt-2 text-xs text-yellow-500/80">{footnote}</p>}
    </div>
  );
}

function EddCard({ evidence, bankName }: { evidence: EddEvidence; bankName: string }) {
  return (
    <div className="mt-3 rounded-xl border border-teal-500/30 bg-teal-500/10 p-4 text-sm">
      <div className="flex items-center gap-2 font-semibold text-teal-300">
        <Clock className="h-4 w-4" /> Early Direct Deposit
      </div>
      <p className="mt-2 text-slate-300">
        {bankName} releases direct deposits an average of{" "}
        <strong className="text-white">
          {evidence.avgDaysEarly}
          {evidence.hasMoreThanFive && "+"}
        </strong>{" "}
        day{evidence.avgDaysEarly !== 1 ? "s" : ""} early, based on {evidence.reportCount}{" "}
        community report{evidence.reportCount !== 1 ? "s" : ""}
        {evidence.hasMoreThanFive && " (some reported more than 5 days)"}.
      </p>
      <p className="mt-1 text-xs text-slate-500">
        Self-reported — no official directory exists for this feature.
      </p>
    </div>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;

  // UUID-style URLs redirect in the page component rather than resolving to
  // a profile here, so there's no bank-specific metadata to build for them.
  if (UUID_PATTERN.test(slug)) return {};

  const profile = await getBankProfileBySlug(slug);
  if (!profile.bank) return {};

  const canonical = `${SITE_URL}/banks/${profile.bank.slug}`;

  return {
    title: `${profile.bank.name} — Bank Transfer Compatibility | InstantRailCheck`,
    description: `Check which payment rails (RTP, FedNow, ACH, Wire, Zelle) ${profile.bank.name} supports, backed by official sources and real-world reports.`,
    alternates: { canonical },
  };
}

export default async function BankProfilePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // Old links used the bank's UUID directly — redirect those to the slug URL
  // instead of 404ing, so anything already shared/indexed keeps working.
  if (UUID_PATTERN.test(slug)) {
    const actualSlug = await getBankSlugById(slug);
    if (actualSlug) {
      permanentRedirect(`/banks/${actualSlug}`);
    }
    notFound();
  }

  const profile = await getBankProfileBySlug(slug);

  if (!profile.bank) {
    notFound();
  }

  // Nonce required even for a non-executing script tag — script-src governs
  // any <script> element regardless of type under this site's CSP.
  const nonce = (await headers()).get("x-nonce");
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BankOrCreditUnion",
    name: profile.bank.name,
    mainEntityOfPage: `${SITE_URL}/banks/${profile.bank.slug}`,
    ...(profile.bank.website ? { url: profile.bank.website } : {}),
    ...(profile.bank.address ? { address: profile.bank.address } : {}),
    ...(profile.bank.phone ? { telephone: profile.bank.phone } : {}),
  };

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <script
        type="application/ld+json"
        nonce={nonce ?? undefined}
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="mx-auto flex w-full max-w-4xl flex-col px-6 pt-10 pb-16">
        <div className="text-center">
          <h1 className="text-3xl font-bold">{profile.bank.name}</h1>
          {profile.bank.website && (
            <a
              href={profile.bank.website}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-block text-sm text-blue-400 hover:text-blue-300"
            >
              {profile.bank.website}
            </a>
          )}
          {profile.bank.address && (
            <p className="mt-1 text-sm text-slate-400">{profile.bank.address}</p>
          )}
          {profile.bank.phone && (
            <p className="mt-1 text-sm text-slate-400">{formatPhone(profile.bank.phone)}</p>
          )}
          {(profile.bank.website || profile.bank.address || profile.bank.phone) && (
            <p className="mt-1 text-xs text-slate-600">
              Contact info sourced from{" "}
              {profile.bank.name.toLowerCase().includes("credit union")
                ? "NCUA's quarterly call report data"
                : "FDIC BankFind"}
              . See{" "}
              <Link href="/methodology" className="text-slate-500 hover:text-slate-400 underline transition">
                methodology
              </Link>
              .
            </p>
          )}
        </div>

        {(profile.bank.fednow_participant || profile.bank.rtp_participant || profile.bank.zelle_participant) && (
          <div className="mt-3 flex flex-wrap justify-center gap-3">
            {profile.bank.fednow_participant && (
              <RailEvidenceCard
                icon={<Landmark className="h-4 w-4" />}
                label="FedNow"
                border="border-purple-500/30"
                bg="bg-purple-500/10"
                text="text-purple-300"
                evidence={profile.railEvidence.fednow}
              />
            )}
            {profile.bank.rtp_participant && (
              <RailEvidenceCard
                icon={<Zap className="h-4 w-4" />}
                label="RTP"
                border="border-green-500/30"
                bg="bg-green-500/10"
                text="text-green-300"
                evidence={profile.railEvidence.rtp}
              />
            )}
            {profile.bank.zelle_participant && (
              <RailEvidenceCard
                icon={<Banknote className="h-4 w-4" />}
                label="Zelle"
                border="border-violet-500/30"
                bg="bg-violet-500/10"
                text="text-violet-300"
                evidence={profile.railEvidence.zelle}
                footnote="Zelle's own directory is known to be incomplete, so a missing badge on other banks doesn't necessarily mean they lack Zelle support."
              />
            )}
          </div>
        )}

        {profile.eddEvidence && <EddCard evidence={profile.eddEvidence} bankName={profile.bank.name} />}

        <SuggestCorrection bankId={profile.bank.id} />
        <SubmitEddReport bankId={profile.bank.id} bankName={profile.bank.name} />

        <section className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
          <h2 className="text-lg font-semibold">Sending from {profile.bank.name}</h2>
          <p className="mt-1 text-sm text-slate-400">
            Rails observed when {profile.bank.name} was the sending bank.
          </p>
          <div className="mt-4">
            <RailList rails={profile.sending} />
          </div>
        </section>

        <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
          <h2 className="text-lg font-semibold">Receiving into {profile.bank.name}</h2>
          <p className="mt-1 text-sm text-slate-400">
            Rails observed when {profile.bank.name} was the receiving bank.
          </p>
          <div className="mt-4">
            <RailList rails={profile.receiving} />
          </div>
        </section>

        <SiteFooterLinks />
      </div>
    </main>
  );
}
