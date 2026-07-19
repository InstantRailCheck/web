import Link from "next/link";
import type { ReactNode } from "react";
import { Clock, CircleArrowRight, Users, Zap } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCommunityReportedBanks, getEddLeaderboardData, type CommunityRailEntry } from "@/lib/communityRails";
import { typicalValueLabel, type EddLeaderboardEntry } from "@/lib/eddLeaderboard";
import { LegalFooterLinks } from "@/components/LegalFooterLinks";
import { PageBreadcrumb } from "@/components/PageBreadcrumb";

export const dynamic = "force-dynamic";

const DISPLAY_LIMIT = 8;

type Bank = { id: string; slug: string; name: string };

function RailColumn({
  icon,
  label,
  color,
  banks,
  total,
  viewAllHref,
  footnote,
}: {
  icon: ReactNode;
  label: string;
  color: string;
  banks: Bank[];
  total: number;
  viewAllHref: string;
  footnote?: string;
}) {
  return (
    <section>
      <h2 className={`flex items-center justify-center gap-2 text-center text-lg font-semibold ${color}`}>
        {icon} {label}
      </h2>
      <p className="mt-1 text-center text-xs text-slate-500">{total} banks</p>
      {footnote && <p className="mt-1 text-center text-xs text-yellow-500/80">{footnote}</p>}
      <div className="mt-3 divide-y divide-slate-800 rounded-2xl border border-slate-800 bg-slate-900/70">
        {banks.length === 0 ? (
          <p className="px-5 py-4 text-sm text-slate-500">None confirmed yet.</p>
        ) : (
          banks.map((bank) => (
            <Link
              key={bank.id}
              href={`/banks/${bank.slug}`}
              className="block px-5 py-3 text-sm text-slate-200 hover:bg-slate-900 hover:text-white transition"
            >
              {bank.name}
            </Link>
          ))
        )}
      </div>
      {total > banks.length && (
        <Link href={viewAllHref} className="mt-2 block text-center text-xs text-blue-400 hover:text-blue-300 transition">
          View all {total} →
        </Link>
      )}
    </section>
  );
}

function CommunityRailColumn({ icon, label, entries }: { icon: string; label: string; entries: CommunityRailEntry[] }) {
  const shown = entries.slice(0, DISPLAY_LIMIT);
  return (
    <section>
      <h2 className="flex items-center justify-center gap-2 text-center text-lg font-semibold">
        <span>{icon}</span> {label}
      </h2>
      <p className="mt-1 text-center text-xs text-slate-500">{entries.length} banks</p>
      <div className="mt-3 divide-y divide-slate-800 rounded-2xl border border-slate-800 bg-slate-900/70">
        {shown.length === 0 ? (
          <p className="px-5 py-4 text-sm text-slate-500">No reports yet.</p>
        ) : (
          shown.map((entry) => (
            <Link
              key={entry.bankId}
              href={`/banks/${entry.bankSlug}`}
              className="flex items-center justify-between px-5 py-3 text-sm text-slate-200 hover:bg-slate-900 hover:text-white transition"
            >
              <span>{entry.bankName}</span>
              <span className="text-xs text-slate-500">
                {entry.successCount} report{entry.successCount !== 1 ? "s" : ""}
              </span>
            </Link>
          ))
        )}
      </div>
    </section>
  );
}

function EddColumn({ entries }: { entries: EddLeaderboardEntry[] }) {
  const shown = entries.slice(0, DISPLAY_LIMIT);
  return (
    <section>
      <h2 className="flex items-center justify-center gap-2 text-center text-lg font-semibold text-teal-300">
        <Clock className="h-[18px] w-[18px]" /> Early Direct Deposit
      </h2>
      <p className="mt-1 text-center text-xs text-slate-500">
        {entries.length} bank{entries.length !== 1 ? "s" : ""} ranked by typical (median) days early
      </p>
      <div className="mt-3 divide-y divide-slate-800 rounded-2xl border border-slate-800 bg-slate-900/70">
        {shown.length === 0 ? (
          <p className="px-5 py-4 text-sm text-slate-500">
            No institution has enough community-reported evidence yet to appear here.
          </p>
        ) : (
          shown.map((entry) => (
            <Link
              key={entry.bankId}
              href={`/banks/${entry.bankSlug}`}
              className="flex items-center justify-between px-5 py-3 text-sm text-slate-200 hover:bg-slate-900 hover:text-white transition"
            >
              <span>{entry.bankName}</span>
              <span className="text-xs text-slate-500">
                {typicalValueLabel(entry.typical)} · {entry.reportCount} report{entry.reportCount !== 1 ? "s" : ""}
              </span>
            </Link>
          ))
        )}
      </div>
      <Link href="/early-direct-deposit" className="mt-2 block text-center text-xs text-blue-400 hover:text-blue-300 transition">
        View the full leaderboard →
      </Link>
    </section>
  );
}

export default async function RailsExplorerPage() {
  const supabase = await createClient();

  const [
    { data: fednow, count: fednowCount },
    { data: rtp, count: rtpCount },
    { data: zelle, count: zelleCount },
    visaDirect,
    mastercardSend,
    eddLeaderboard,
  ] = await Promise.all([
      supabase
        .from("banks")
        .select("id, slug, name", { count: "exact" })
        .eq("fednow_participant", true)
        .eq("is_active", true)
        .order("total_assets", { ascending: false, nullsFirst: false })
        .order("name")
        .limit(DISPLAY_LIMIT),
      supabase
        .from("banks")
        .select("id, slug, name", { count: "exact" })
        .eq("rtp_participant", true)
        .eq("is_active", true)
        .order("total_assets", { ascending: false, nullsFirst: false })
        .order("name")
        .limit(DISPLAY_LIMIT),
      supabase
        .from("banks")
        .select("id, slug, name", { count: "exact" })
        .eq("zelle_participant", true)
        .eq("is_active", true)
        .order("total_assets", { ascending: false, nullsFirst: false })
        .order("name")
        .limit(DISPLAY_LIMIT),
      getCommunityReportedBanks("Visa Direct"),
      getCommunityReportedBanks("Mastercard Send"),
      getEddLeaderboardData(),
    ]);

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex w-full max-w-4xl flex-col px-6 pt-10 pb-16">
        <PageBreadcrumb
          items={[
            { name: "Home", href: "/" },
            { name: "Payment rail explorer", href: "/rails" },
          ]}
        />
        <h1 className="text-center text-3xl font-bold">Payment rail explorer</h1>
        <p className="mt-1 text-center text-sm text-slate-400">
          Banks in our database confirmed as participants on each network, verified against the
          Federal Reserve&apos;s FedNow participant list, The Clearing House&apos;s RTP participant list,
          and Zelle&apos;s partner directory.
        </p>

        <div className="mt-8 grid gap-8 sm:grid-cols-3">
          <RailColumn
            icon={<CircleArrowRight className="h-[18px] w-[18px]" />}
            label="FedNow"
            color="text-purple-300"
            banks={fednow ?? []}
            total={fednowCount ?? 0}
            viewAllHref="/banks?fednow=true"
          />
          <RailColumn
            icon={<Zap className="h-[18px] w-[18px]" />}
            label="RTP"
            color="text-green-300"
            banks={rtp ?? []}
            total={rtpCount ?? 0}
            viewAllHref="/banks?rtp=true"
          />
          <RailColumn
            icon={<Users className="h-[18px] w-[18px]" />}
            label="P2P - Zelle"
            color="text-white"
            banks={zelle ?? []}
            total={zelleCount ?? 0}
            viewAllHref="/banks?zelle=true"
            footnote="Zelle's own directory is known to be incomplete — a missing badge doesn't confirm a bank lacks support, only that it isn't listed there."
          />
        </div>

        <div className="mt-12 border-t border-slate-800 pt-8">
          <h2 className="text-center text-xl font-semibold">Community-reported</h2>
          <p className="mt-1 text-center text-sm text-slate-400">
            No official directory exists for these networks — based on user-submitted reports
            only, not independently verified. Requires at least 2 successful reports to appear.
          </p>

          <div className="mt-6 grid gap-8 sm:grid-cols-2">
            <CommunityRailColumn icon="💳" label="Visa Direct" entries={visaDirect} />
            <CommunityRailColumn icon="💳" label="Mastercard Send" entries={mastercardSend} />
          </div>
        </div>

        <div className="mt-12 border-t border-slate-800 pt-8">
          <p className="text-center text-sm text-slate-400">
            A per-bank feature, not a network — no official directory exists since it&apos;s a
            marketing feature banks choose to offer, so this is based on user-submitted reports
            only. A preview of the{" "}
            <Link href="/early-direct-deposit" className="text-blue-400 hover:text-blue-300 transition">
              full leaderboard
            </Link>
            , which requires at least 5 distinct reporters to rank an institution.
          </p>

          <div className="mt-6">
            <EddColumn entries={eddLeaderboard.ranked} />
          </div>
        </div>

        <LegalFooterLinks />
      </div>
    </main>
  );
}
