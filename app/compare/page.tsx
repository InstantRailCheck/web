import type { Metadata } from "next";
import Link from "next/link";
import { getBankProfileBySlug, getBankBySlug, describeRailEvidence } from "@/lib/bankProfile";
import { ComparePicker } from "@/components/ComparePicker";
import { LegalFooterLinks } from "@/components/LegalFooterLinks";
import { formatPhone, telHref } from "@/lib/utils";
import { compareMetadata, type CompareSearchParams } from "@/lib/seo";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<CompareSearchParams>;
}): Promise<Metadata> {
  return compareMetadata(await searchParams);
}

function RailCell({
  rail,
}: {
  rail: Awaited<ReturnType<typeof getBankProfileBySlug>>["sending"][number] | undefined;
}) {
  if (!rail) return <span className="text-slate-600">No data</span>;
  return (
    <span>
      {describeRailEvidence(rail)}
      {rail.avgTime !== null && ` · ~${rail.avgTime}m`}
      {rail.isStale && <span className="text-yellow-400"> (stale)</span>}
    </span>
  );
}

function PhoneCell({ phone }: { phone: string | null }) {
  const href = telHref(phone);
  if (!href) return <span className="text-slate-600">—</span>;
  return (
    <a href={href} className="hover:text-slate-300 transition">
      {formatPhone(phone)}
    </a>
  );
}

function WebsiteCell({ website }: { website: string | null }) {
  if (!website) return <span className="text-slate-600">—</span>;
  return (
    <a
      href={website}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-400 hover:text-blue-300 transition"
    >
      {website}
    </a>
  );
}

function EddCell({ evidence }: { evidence: { avgDaysEarly: number; reportCount: number; hasMoreThanFive: boolean } | null }) {
  if (!evidence) return <span className="text-slate-600">No data</span>;
  return (
    <span>
      {evidence.avgDaysEarly}
      {evidence.hasMoreThanFive && "+"} day{evidence.avgDaysEarly !== 1 ? "s" : ""} early
      <span className="text-slate-500">
        {" "}
        ({evidence.reportCount} report{evidence.reportCount !== 1 ? "s" : ""})
      </span>
    </span>
  );
}

type Profile = Awaited<ReturnType<typeof getBankProfileBySlug>>;

function findRail(profile: Profile, rail: string) {
  return profile.sending.find((r) => r.rail === rail) ?? profile.receiving.find((r) => r.rail === rail);
}

// These have no official participant directory (unlike FedNow/RTP/Zelle), so
// unlike those, they'd otherwise only appear once someone actually reports
// on them — show them as always-present rows so the comparison is consistent.
const ALWAYS_SHOWN_RAILS = ["Visa Direct", "Mastercard Send"];

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<CompareSearchParams>;
}) {
  const { banks: banksParam } = await searchParams;
  const slugs = (banksParam ?? "").split(",").filter(Boolean).slice(0, 2);

  const profiles = slugs.length === 2 ? await Promise.all(slugs.map((slug) => getBankProfileBySlug(slug))) : null;
  const [a, b] = profiles ?? [null, null];

  // Resolves the picker's pre-filled selections without ever fetching the
  // full bank directory: a two-slug URL already resolved both banks above
  // via getBankProfileBySlug, so reuse that; a lone first slug (e.g. someone
  // picked bank A and hasn't picked bank B yet) needs one small extra lookup.
  let initialBankA = a?.bank ? { id: a.bank.id, slug: a.bank.slug, name: a.bank.name } : null;
  const initialBankB = b?.bank ? { id: b.bank.id, slug: b.bank.slug, name: b.bank.name } : null;
  if (!initialBankA && slugs.length >= 1) {
    initialBankA = await getBankBySlug(slugs[0]);
  }

  // Merges sending + receiving so community-reported rails with no official
  // participant flag (Visa Direct, Mastercard Send, etc.) still surface here
  // even if reports only exist for one direction.
  const rails =
    a && b
      ? Array.from(
          new Set([
            ...a.sending.map((r) => r.rail),
            ...a.receiving.map((r) => r.rail),
            ...b.sending.map((r) => r.rail),
            ...b.receiving.map((r) => r.rail),
          ])
        ).filter((rail) => !ALWAYS_SHOWN_RAILS.includes(rail))
      : [];

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex w-full max-w-4xl flex-col px-6 pt-10 pb-16">
        <h1 className="text-center text-3xl font-bold">Compare banks</h1>
        <p className="mt-1 text-center text-sm text-slate-400">
          Side-by-side rail capability, contact info, and network participation.
        </p>

        <div className="mt-6">
          {/* BankSelect is uncontrolled (initialBank only seeds first mount),
              so a router.push()-driven navigation to a different ?banks=
              value wouldn't otherwise resync the pickers' displayed value —
              keying on the resolved slugs forces a fresh mount instead. */}
          <ComparePicker
            key={`${initialBankA?.slug ?? ""}-${initialBankB?.slug ?? ""}`}
            initialBankA={initialBankA}
            initialBankB={initialBankB}
          />
        </div>

        {a?.bank && b?.bank && (
          <div className="mt-8 overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/70">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-800">
                  <th className="px-5 py-3 text-slate-500">Feature</th>
                  <th className="px-5 py-3">
                    <Link href={`/banks/${a.bank.slug}`} className="text-blue-400 hover:text-blue-300 transition">
                      {a.bank.name}
                    </Link>
                    {!a.bank.is_active && <span className="ml-1.5 text-xs text-yellow-400">(no longer listed)</span>}
                  </th>
                  <th className="px-5 py-3">
                    <Link href={`/banks/${b.bank.slug}`} className="text-blue-400 hover:text-blue-300 transition">
                      {b.bank.name}
                    </Link>
                    {!b.bank.is_active && <span className="ml-1.5 text-xs text-yellow-400">(no longer listed)</span>}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                <tr>
                  <td className="px-5 py-3 text-slate-500">Website</td>
                  <td className="px-5 py-3">
                    <WebsiteCell website={a.bank.website} />
                  </td>
                  <td className="px-5 py-3">
                    <WebsiteCell website={b.bank.website} />
                  </td>
                </tr>
                <tr>
                  <td className="px-5 py-3 text-slate-500">Address</td>
                  <td className="px-5 py-3">{a.bank.address ?? <span className="text-slate-600">—</span>}</td>
                  <td className="px-5 py-3">{b.bank.address ?? <span className="text-slate-600">—</span>}</td>
                </tr>
                <tr>
                  <td className="px-5 py-3 text-slate-500">Phone</td>
                  <td className="px-5 py-3">
                    <PhoneCell phone={a.bank.phone} />
                  </td>
                  <td className="px-5 py-3">
                    <PhoneCell phone={b.bank.phone} />
                  </td>
                </tr>
                <tr>
                  <td className="px-5 py-3 text-slate-500">FedNow</td>
                  <td className="px-5 py-3">{a.bank.fednow_participant ? "✅" : "—"}</td>
                  <td className="px-5 py-3">{b.bank.fednow_participant ? "✅" : "—"}</td>
                </tr>
                <tr>
                  <td className="px-5 py-3 text-slate-500">RTP</td>
                  <td className="px-5 py-3">{a.bank.rtp_participant ? "✅" : "—"}</td>
                  <td className="px-5 py-3">{b.bank.rtp_participant ? "✅" : "—"}</td>
                </tr>
                <tr>
                  <td className="px-5 py-3 text-slate-500">P2P Payments</td>
                  <td className="px-5 py-3">{a.bank.zelle_participant ? "✅" : "—"}</td>
                  <td className="px-5 py-3">{b.bank.zelle_participant ? "✅" : "—"}</td>
                </tr>
                {ALWAYS_SHOWN_RAILS.map((rail) => (
                  <tr key={rail}>
                    <td className="px-5 py-3 text-slate-500">{rail}</td>
                    <td className="px-5 py-3">
                      <RailCell rail={findRail(a, rail)} />
                    </td>
                    <td className="px-5 py-3">
                      <RailCell rail={findRail(b, rail)} />
                    </td>
                  </tr>
                ))}
                {rails.map((rail) => (
                  <tr key={rail}>
                    <td className="px-5 py-3 text-slate-500">{rail}</td>
                    <td className="px-5 py-3">
                      <RailCell rail={findRail(a, rail)} />
                    </td>
                    <td className="px-5 py-3">
                      <RailCell rail={findRail(b, rail)} />
                    </td>
                  </tr>
                ))}
                <tr>
                  <td className="px-5 py-3 text-slate-500">Early Direct Deposit</td>
                  <td className="px-5 py-3">
                    <EddCell evidence={a.eddEvidence} />
                  </td>
                  <td className="px-5 py-3">
                    <EddCell evidence={b.eddEvidence} />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        <LegalFooterLinks />
      </div>
    </main>
  );
}
